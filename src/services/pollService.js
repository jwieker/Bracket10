import { gameRepository } from "../repositories/index.js";
import { updateTeamRecords } from "./gameService.js";
import { updatePointsForAffectedEntries } from "./pointsService.js";
import { fetchCompletedTournamentGames, getDateStrDaysAgo, loadTeamMap } from "./espnService.js";
import Logger from "../utils/logger.js";

/**
 * Runs the points recalc for every team sID in the durable pending-recalc
 * marker, then removes the processed sIDs from the marker. The marker is
 * written BEFORE game results (see step 4 below), so any run that recorded
 * results but failed/died before its recalc leaves the sIDs behind for the
 * next run to pick up here. Recalc is idempotent — it recomputes from
 * current DB state — so processing a superset of sIDs is always safe.
 */
async function recalcPendingEntries(year) {
  const pendingSIDs = await gameRepository.getPendingRecalcSIDs(year);
  if (pendingSIDs.length === 0) return;
  Logger.info(`ESPN poll: recalculating points for entries holding ${pendingSIDs.length} pending team(s)`);
  await updatePointsForAffectedEntries(year, pendingSIDs);
  await gameRepository.clearPendingRecalcSIDs(year, pendingSIDs);
}

/**
 * Main polling orchestrator. Fetches today's completed NCAA games from ESPN,
 * matches them to our tournament DB, and records any newly-finished games.
 *
 * @param {number} year - Tournament year
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - If true, skip DB writes and just return what would be updated
 * @returns {Promise<{updated: number, skipped: number, unmapped: string[], games: Array}>}
 */
export async function runEspnPoll(year, { dryRun = false, dateStr = null } = {}) {
  const teamMap = loadTeamMap();
  const summary = { updated: 0, skipped: 0, unmapped: [], games: [] };

  // 0. Recover from a previous run that wrote game results but failed before
  // its recalc. This must run before the early exits below: if the failed
  // run resolved the LAST unresolved game (e.g. the championship), every
  // later run takes the "nothing to do" exit and would otherwise leave
  // standings wrong forever.
  if (!dryRun) {
    await recalcPendingEntries(year);
  }

  // 1. Fetch all current-year games from DB; keep only unresolved ones.
  // Games with manualHold (set by an admin undo) are skipped: the ESPN feed
  // still lists them as completed for ~48h, and without the hold the poll
  // would re-resolve an undone game within one cycle. The hold is released
  // when an admin records a result (updateWinner) or explicitly releases it.
  const allGames = await gameRepository.getActiveAndFutureGames(year);
  const unresolvedGames = allGames.filter((g) => g.winner == null && !g.manualHold);

  if (unresolvedGames.length === 0) {
    Logger.info("ESPN poll: no unresolved games in DB — nothing to do");
    return summary;
  }

  const unresolvedGamesMap = new Map();
  for (const g of unresolvedGames) {
    if (g.team1ID != null && g.team2ID != null) {
      const minID = Math.min(g.team1ID, g.team2ID);
      const maxID = Math.max(g.team1ID, g.team2ID);
      const key = `${minID}-${maxID}`;
      if (!unresolvedGamesMap.has(key)) {
        unresolvedGamesMap.set(key, g);
      }
    }
  }

  // 2. Fetch completed games from ESPN.
  // If a specific dateStr is provided (dev/test override), fetch only that date.
  // Otherwise fetch today + yesterday to catch late/overnight games.
  let espnGames;
  try {
    if (dateStr) {
      espnGames = await fetchCompletedTournamentGames(dateStr);
    } else {
      const [todayGames, yesterdayGames] = await Promise.all([
        fetchCompletedTournamentGames(),
        fetchCompletedTournamentGames(getDateStrDaysAgo(1)),
      ]);
      // Deduplicate by espnEventId — yesterday's games may already appear in today's feed
      const seen = new Set();
      espnGames = [...todayGames, ...yesterdayGames].filter(({ espnEventId }) => {
        if (seen.has(espnEventId)) return false;
        seen.add(espnEventId);
        return true;
      });
    }
  } catch (err) {
    Logger.error("ESPN poll: aborting due to ESPN fetch error", err);
    throw err;
  }

  if (espnGames.length === 0) {
    Logger.info("ESPN poll: ESPN returned no completed games today or yesterday");
    return summary;
  }
  // 3. Match each ESPN completed game to an unresolved DB game
  const gamesToWrite = [];
  for (const espnGame of espnGames) {
    const winnerSID = teamMap[espnGame.winnerDisplayName];
    const loserDisplayName =
      espnGame.team1DisplayName === espnGame.winnerDisplayName
        ? espnGame.team2DisplayName
        : espnGame.team1DisplayName;
    const loserSID = teamMap[loserDisplayName];

    if (winnerSID == null || loserSID == null) {
      const unmappedNames = [
        winnerSID == null ? espnGame.winnerDisplayName : null,
        loserSID == null ? loserDisplayName : null,
      ].filter(Boolean);
      summary.unmapped.push(...unmappedNames);
      Logger.warn(`ESPN poll: no mapping for team(s): ${unmappedNames.join(", ")}`);
      continue;
    }

    // Find matching unresolved game where both teams are present
    // Strict type check to prevent string/number coercion mismatches that weren't possible with `.find(===)`
    let dbGame = null;
    if (typeof winnerSID === "number" && typeof loserSID === "number") {
      const minSID = Math.min(winnerSID, loserSID);
      const maxSID = Math.max(winnerSID, loserSID);
      dbGame = unresolvedGamesMap.get(`${minSID}-${maxSID}`);
    }

    if (!dbGame) {
      // Both teams mapped but no matching unresolved game — likely already recorded
      summary.skipped++;
      continue;
    }

    summary.games.push({
      gameID: dbGame.gameID,
      round: dbGame.round,
      winnerSID,
      loserSID,
      winnerDisplayName: espnGame.winnerDisplayName,
      team1ID: dbGame.team1ID,
      team2ID: dbGame.team2ID,
      nextGameID: dbGame.nextGameID,
      nextGameSpot: dbGame.nextGameSpot,
    });

    if (dryRun) {
      Logger.info(
        `ESPN poll (dry-run): would record winner sID=${winnerSID} for game ${dbGame.gameID} (round ${dbGame.round})`
      );
      summary.updated++;
      continue;
    }

    gamesToWrite.push({ dbGame, winnerSID, loserSID });
  }

  // 4. Write all matched games in parallel — each game writes to distinct documents
  //    (unique gameID, unique team records) so concurrent writes are safe.
  if (gamesToWrite.length > 0) {
    // Durably mark the affected teams BEFORE writing any result. Once a game's
    // winner is written it leaves the unresolved set and is never retried, so
    // a crash between the result writes and the recalc would otherwise strand
    // wrong standings. With the marker first, the worst case is a harmless
    // extra recalc on the next run. If this write fails, nothing has been
    // written yet and the whole run aborts cleanly.
    const affectedSIDs = [
      ...new Set(gamesToWrite.flatMap(({ winnerSID, loserSID }) => [winnerSID, loserSID])),
    ];
    await gameRepository.addPendingRecalcSIDs(year, affectedSIDs);

    Logger.info(`ESPN poll: recording ${gamesToWrite.length} game result(s) in parallel`);
    const results = await Promise.allSettled(
      gamesToWrite.map(({ dbGame, winnerSID, loserSID }) => {
        Logger.info(
          `ESPN poll: recording winner sID=${winnerSID} for game ${dbGame.gameID} (round ${dbGame.round})`
        );
        return updateTeamRecords(
          winnerSID,
          loserSID,
          dbGame.round,
          dbGame.gameID,
          dbGame.nextGameID,
          dbGame.nextGameSpot,
          year
        );
      })
    );
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "fulfilled") {
        summary.updated++;
      } else {
        Logger.error(`ESPN poll: failed to update game ${gamesToWrite[i].dbGame.gameID}`, results[i].reason);
      }
    }
  }

  // 5. Recalculate entry points, driven by the durable marker rather than this
  // run's update count — so the recalc covers this run's writes AND anything
  // a previous failed run left pending (skip in dry-run, which never writes
  // the marker). No-ops when the marker is empty.
  if (!dryRun) {
    await recalcPendingEntries(year);
  }

  Logger.info(
    `ESPN poll complete — updated: ${summary.updated}, skipped: ${summary.skipped}, unmapped teams: ${summary.unmapped.length}`
  );
  return summary;
}
