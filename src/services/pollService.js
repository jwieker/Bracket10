import { createRequire } from "module";
import { gameRepository } from "../repositories/index.js";
import { updateTeamRecords } from "./gameService.js";
import { updatePointsForAffectedEntries } from "./pointsService.js";
import { fetchCompletedTournamentGames, getDateStrDaysAgo } from "./espnService.js";
import Logger from "../utils/logger.js";

const require = createRequire(import.meta.url);

/**
 * Loads the ESPN display-name → internal sID mapping from config.
 * Returns an object like { "Duke Blue Devils": 264, ... }
 */
function loadTeamMap() {
  try {
    return require("../config/espnTeamMap.json");
  } catch {
    Logger.warn("ESPN poll: espnTeamMap.json not found or invalid — no games will be matched");
    return {};
  }
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

  // 1. Fetch all current-year games from DB; keep only unresolved ones
  const allGames = await gameRepository.getActiveAndFutureGames(year);
  const unresolvedGames = allGames.filter((g) => g.winner == null);

  if (unresolvedGames.length === 0) {
    Logger.info("ESPN poll: no unresolved games in DB — nothing to do");
    return summary;
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
    const dbGame = unresolvedGames.find(
      (g) =>
        (g.team1ID === winnerSID && g.team2ID === loserSID) ||
        (g.team1ID === loserSID && g.team2ID === winnerSID)
    );

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

  // 5. Recalculate all entry points once if any games were updated (skip in dry-run)
  if (!dryRun && summary.updated > 0) {
    Logger.info(`ESPN poll: recalculating points after ${summary.updated} update(s)`);
    const affectedSIDs = [...new Set(summary.games.flatMap(g => [g.winnerSID, g.loserSID]))];
    await updatePointsForAffectedEntries(year, affectedSIDs);
  }

  Logger.info(
    `ESPN poll complete — updated: ${summary.updated}, skipped: ${summary.skipped}, unmapped teams: ${summary.unmapped.length}`
  );
  return summary;
}
