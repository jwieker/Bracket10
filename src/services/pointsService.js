import { TOURNAMENT_ROUNDS, APP_CONFIG } from "../config/app.js";
import { gameRepository as _gameRepository, entryRepository as _entryRepository, tourneyRepository as _tourneyRepository } from "../repositories/index.js";

let gameRepository = _gameRepository;
let entryRepository = _entryRepository;
let tourneyRepository = _tourneyRepository;

// For testing purposes
export function setRepositories(newGameRepository, newEntryRepository, newTourneyRepository) {
  gameRepository = newGameRepository;
  entryRepository = newEntryRepository;
  tourneyRepository = newTourneyRepository;
}
import Logger from "../utils/logger.js";
import { withErrorHandling } from "../utils/errors.js";

// Tolerance for tie detection in `possibleRanking`. Point increments are integers
// (min 1), so any window below 1 cannot collapse genuinely distinct totals while
// safely absorbing float-accumulation drift from upstream Firestore values.
const POINTS_EPSILON = 1e-9;


async function getTournamentData(year) {
  const yearNum = Number(year);
  const activeGames = await gameRepository.getActiveGames(yearNum);

  if (activeGames.length === 0) {
    const regions = await tourneyRepository.getAllRegionTypes();
    return {
      isNewTournament: true,
      regions,
      year: yearNum,
    };
  }

  // Games already have team1Name, team1Seed, team2Name, team2Seed natively denormalized
  return {
    isNewTournament: false,
    activeGames,
    year: yearNum,
  };
}

/**
 * Builds the three O(1) lookup maps shared across all entries in a batch.
 * Callers processing many entries should build once and pass via prebuiltMaps.
 */
function buildLookupMaps(allTeams, activeGames) {
  const teamMap = new Map(allTeams.map(t => [t.sID, t]));
  const gameById = new Map(activeGames.map(g => [g.gameID, g]));
  const gameByTeam = new Map();
  // Sort by round ASC so that higher round games (current/next) overwrite 
  // lower round games (historical) for the same team.
  const sortedGames = [...activeGames].sort((a, b) => (a.round || 0) - (b.round || 0));
  for (const g of sortedGames) {
    if (g.team1ID != null) gameByTeam.set(g.team1ID, g);
    if (g.team2ID != null) gameByTeam.set(g.team2ID, g);
  }
  return { teamMap, gameByTeam, gameById };
}

/**
 * Calculates current points, max possible points, and future game paths for a given set of picks.
 * @param {number[]} picks - Array of team sIDs for the entry.
 * @param {Array} allTeams - Array of all team objects (must include sID, points, gameStatus).
 * @param {Array} activeGames - Array of active/future game objects (must include gameID, team1ID, team2ID, winner, nextGameID).
 * @param {object} [prebuiltMaps] - Optional pre-built lookup maps from buildLookupMaps(). Pass when
 *   calling in a loop over many entries so the maps are built once rather than per-entry.
 * @returns {object} An object { currentPoints: number, maxPoints: number, futureGamePaths: Array<Array<number|string>> }
 */
function calculateEntryPointsAndPaths(picks, allTeams, activeGames, prebuiltMaps = null) {
  const { teamMap, gameByTeam, gameById } = prebuiltMaps ?? buildLookupMaps(allTeams, activeGames);

  let currentPoints = 0;
  const futureGamePaths = [];

  for (const pickId of picks) {
    const team = teamMap.get(pickId);
    if (!team) {
      Logger.warn(`Team with sID ${pickId} not found in allTeams. Skipping pick.`);
      futureGamePaths.push([]);
      continue;
    }

    currentPoints += team.points || 0;

    const isActive =
      !team.gameStatus?.length ||
      team.gameStatus[team.gameStatus.length - 1] === "W";

    if (isActive) {
      const nextGame = gameByTeam.get(team.sID);
      let nextGameID = (nextGame && nextGame.winner === null) ? nextGame.gameID : -1;

      // FF games (round 0) award zero points and must not appear in the scoring path.
      // Skip the FF game and start the path at the R1 game it feeds into.
      if (nextGameID !== -1 && nextGame.round === 0) {
        nextGameID = nextGame.nextGameID ?? -1;
      }

      if (nextGameID !== -1) {
        const initialPath = [...(team.gameStatus || []), nextGameID];
        const completeFuturePath = getNextFutureGame(initialPath, gameById, nextGameID);
        futureGamePaths.push(completeFuturePath ?? []);
      } else {
        futureGamePaths.push([]);
      }
    } else {
      futureGamePaths.push([]);
    }
  }

  const maxPoints = getFuturePoints(futureGamePaths, currentPoints);
  return { currentPoints, maxPoints, futureGamePaths };
}

async function updatePossiblePoints(year = thisYear, group = APP_CONFIG.tournament.defaultGroup) {
  const [activeGames, allEntries, allTeams] = await Promise.all([
    gameRepository.getActiveAndFutureGames(year),
    gameRepository.getAllEntries(year),
    gameRepository.getTournamentTeams(year),
  ]);

  const maps = buildLookupMaps(allTeams, activeGames);

  const pointsArray = allEntries.map((entry) => {
    const { currentPoints, maxPoints, futureGamePaths } =
      calculateEntryPointsAndPaths(entry.picks, allTeams, activeGames, maps);

    return {
      entryID: Number(entry.id),
      points: Number(currentPoints),
      possPoints: Number(maxPoints),
      futureGames: futureGamePaths,
      name: entry.teamName,
      groupName: entry.group,
    };
  });

  const chunkSize = APP_CONFIG.tournament.chunkSize;
  const chunks = [];
  for (let i = 0; i < pointsArray.length; i += chunkSize) {
    chunks.push(pointsArray.slice(i, i + chunkSize));
  }

  const totalStartTime = Date.now();

  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    const startTime = Date.now();
    Logger.info(
      `Updating chunk number ${index} of total chunks ${chunks.length} for year ${year}`
    );
    await entryRepository.updateMultipleEntryPoints(chunk, year);
    const duration = Date.now() - startTime;
    Logger.performance(`Chunk update`, duration);
  }

  const totalEndTime = Date.now();
  const totalDuration = totalEndTime - totalStartTime;
  Logger.performance(`Total points update`, totalDuration);
}

/**
 * Enriches a list of entries with potential ranking information.
 * @param {Array<Object>} entriesToEnrich - Array of entry objects. Expected to have: id, picks, teamName, group.
 * @param {Array<Object>} allTeamsData - Array of all team data.
 * @param {Array<Object>} activeGamesData - Array of active/future games.
 * @returns {Promise<Array<Object>>} The array of entries, enriched with ranking data.
 */
function enrichEntriesWithPotentialRankings(
  entriesToEnrich,
  allTeamsData,
  activeGamesData
) {
  const maps = buildLookupMaps(allTeamsData, activeGamesData);

  // Single pass: compute points, paths, pickSet, and minPoints together
  const enrichedEntries = entriesToEnrich.map((entry) => {
    const { currentPoints, maxPoints, futureGamePaths } =
      calculateEntryPointsAndPaths(entry.picks, allTeamsData, activeGamesData, maps);

    return {
      ...entry,
      entryID: Number(entry.id || entry.entryID),
      name: entry.teamName || entry.name,
      points: Number(currentPoints),
      maxPoints: Number(maxPoints),
      futureGames: futureGamePaths,
      pickSet: new Set(entry.picks),
      minPoints: minPoints(futureGamePaths, Number(currentPoints)),
    };
  });

  // Calculate highest possible place for each entry
  for (const entry of enrichedEntries) {
    const { highestPlace, ties } = getHighestPlace(entry, enrichedEntries);
    entry.highestPlace = highestPlace;
    entry.ties = ties;
  }

  return enrichedEntries;
}

async function possibleRanking(year = thisYear, group = APP_CONFIG.tournament.defaultGroup) {
  const [activeGames, entriesForGroup, allTeams] = await Promise.all([
    gameRepository.getActiveAndFutureGames(year),
    gameRepository.getEntriesForGroup(year, group),
    gameRepository.getTournamentTeams(year),
  ]);

  if (entriesForGroup.length === 0) {
    Logger.info(
      `No entries found for group "${group}" in year ${year} for possible ranking.`
    );
    return [];
  }

  const enrichedAndRankedEntries = await enrichEntriesWithPotentialRankings(
    entriesForGroup,
    allTeams,
    activeGames
  );

  return enrichedAndRankedEntries.sort((a, b) => {
    if (a.highestPlace !== b.highestPlace) {
      return a.highestPlace - b.highestPlace;
    }
    return a.name.localeCompare(b.name);
  });
}

function getHighestPlace(entry, allBobEntries) {
  let highestPlace = 1;
  let ties = 0;

  const entryPickSet = entry.pickSet ?? new Set(entry.picks);
  const entryMaxPoints = entry.maxPoints;
  const entryCurrentPoints = entry.points;

  // Memoize potentialFromUniquePicks for this entry's pick subsets.
  // Many 'other' entries will share the same set of overlapping picks.
  // JS bitwise operators are 32-bit; limit cache to 31 picks to avoid overflow.
  const canUseCache = entry.picks.length <= 31;
  const uniquePotentialCache = canUseCache ? new Map() : null;

  for (const otherEntry of allBobEntries) {
    if (otherEntry.entryID === entry.entryID) continue;

    // ── Early-exit bounds checks ──
    // When absolute bounds are available (from enrichEntriesWithPotentialRankings),
    // we can skip the expensive unique-pick analysis for clear-cut pairs.
    if (entryMaxPoints != null && otherEntry.maxPoints != null) {
      // If our ceiling is below their current points, they beat us in every scenario.
      if (entryMaxPoints < otherEntry.points) {
        highestPlace++;
        continue;
      }
      // If our current points already exceed their ceiling, we beat them in every scenario.
      if (entryCurrentPoints > otherEntry.maxPoints) {
        continue;
      }
    }

    const otherPickSet = otherEntry.pickSet ?? new Set(otherEntry.picks);

    let potentialFromUniquePicks;

    if (canUseCache) {
      // Identify which of our picks are unique compared to this otherEntry.
      let mask = 0;
      for (let i = 0; i < entry.picks.length; i++) {
        if (!otherPickSet.has(entry.picks[i])) {
          mask |= (1 << i);
        }
      }

      if (uniquePotentialCache.has(mask)) {
        potentialFromUniquePicks = uniquePotentialCache.get(mask);
      } else {
        const uniqueToEntryPaths = [];
        for (let i = 0; i < entry.picks.length; i++) {
          if (mask & (1 << i)) {
            uniqueToEntryPaths.push(entry.futureGames[i]);
          }
        }
        potentialFromUniquePicks = getFuturePoints(uniqueToEntryPaths, entry.points);
        uniquePotentialCache.set(mask, potentialFromUniquePicks);
      }
    } else {
      // Fallback for > 31 picks
      const uniqueToEntryPaths = [];
      for (let i = 0; i < entry.picks.length; i++) {
        if (!otherPickSet.has(entry.picks[i])) {
          uniqueToEntryPaths.push(entry.futureGames[i]);
        }
      }
      potentialFromUniquePicks = getFuturePoints(uniqueToEntryPaths, entry.points);
    }

    // B's relative floor: only clashes among B's UNIQUE picks (shared picks excluded)
    const otherUniquePaths = [];
    for (let i = 0; i < otherEntry.picks.length; i++) {
      if (!entryPickSet.has(otherEntry.picks[i])) {
        otherUniquePaths.push(otherEntry.futureGames[i]);
      }
    }
    const otherRelativeMin = minPoints(otherUniquePaths, otherEntry.points);

    // Use epsilon-tolerant equality for the tie branch. Point values are
    // integers today, but `points` reads from Firestore which has no integer
    // type, so any upstream change that introduces fractional arithmetic could
    // desync mathematically-equal values via float accumulation. A 1e-9 window
    // is far below the smallest possible point increment (1) so it cannot
    // collapse genuinely distinct totals.
    if (potentialFromUniquePicks < otherRelativeMin - POINTS_EPSILON) {
      highestPlace++;
    } else if (Math.abs(potentialFromUniquePicks - otherRelativeMin) < POINTS_EPSILON) {
      ties++;
    }
  }

  return { highestPlace, ties };
}

/**
 * Calculates the minimum guaranteed points for an entry.
 */
function minPoints(futureGames, currentPoints = 0) {
  let guaranteedRoundPointsFromClashes = 0;
  const nextGameSlotsForPicks = [];

  for (const pickPath of futureGames) {
    for (let roundIndex = 0; roundIndex < pickPath.length; roundIndex++) {
      if (pickPath[roundIndex] !== "W") {
        nextGameSlotsForPicks.push({
          gameId: pickPath[roundIndex],
          round: roundIndex + 1,
        });
        break;
      }
    }
  }

  const countedClashSlots = new Set();

  for (let i = 0; i < nextGameSlotsForPicks.length; i++) {
    for (let j = i + 1; j < nextGameSlotsForPicks.length; j++) {
      const slotA = nextGameSlotsForPicks[i];
      const slotB = nextGameSlotsForPicks[j];

      if (slotA.gameId === slotB.gameId && slotA.round === slotB.round) {
        const gameSlotKey = `${slotA.gameId}-${slotA.round}`;
        if (!countedClashSlots.has(gameSlotKey)) {
          const roundConfig = TOURNAMENT_ROUNDS[slotA.round];
          if (roundConfig && roundConfig.roundPoints) {
            guaranteedRoundPointsFromClashes += roundConfig.roundPoints;
          }
          countedClashSlots.add(gameSlotKey);
        }
      }
    }
  }
  return currentPoints + guaranteedRoundPointsFromClashes;
}

function findNextGameId(teamId, activeGames) {
  const game = activeGames.find(
    (game) =>
      (game.team1ID === teamId || game.team2ID === teamId) &&
      game.winner === null
  );
  return game ? game.gameID : -1;
}

// Bracket chains are bounded by tournament rounds (R1→Champ is 6 steps for the
// main draw, +1 for First Four). MAX_DEPTH gives generous headroom while still
// preventing a corrupted nextGameID self-reference or cycle from taking down
// all points calculation via stack overflow / infinite recursion.
const MAX_FUTURE_GAME_DEPTH = 10;

function getNextFutureGame(futureGames, activeGamesOrMap, nextGameID) {
  // Accepts either an array (legacy/test) or a Map (internal optimised path)
  const lookup = (id) =>
    activeGamesOrMap instanceof Map
      ? activeGamesOrMap.get(id)
      : activeGamesOrMap?.find((g) => g.gameID === id);

  const collected = [...futureGames];
  const visited = new Set();
  let currentId = nextGameID;

  for (let depth = 0; depth < MAX_FUTURE_GAME_DEPTH; depth++) {
    if (visited.has(currentId)) {
      Logger.error(
        `getNextFutureGame: cycle detected at gameID ${currentId} (visited: ${[...visited].join(",")})`
      );
      return collected;
    }
    visited.add(currentId);

    const game = lookup(currentId);
    if (!game) return null;

    const nextUp = game.nextGameID;
    if (nextUp === 0) return collected;

    collected.push(nextUp);
    currentId = nextUp;
  }

  Logger.error(
    `getNextFutureGame: exceeded max depth ${MAX_FUTURE_GAME_DEPTH} starting from gameID ${nextGameID}`
  );
  return collected;
}

function getFuturePoints(futureGames, currentPoints) {
  // Previously this function swallowed errors and returned `currentPoints`,
  // making "no future points" and "calculation crashed" indistinguishable to
  // callers — a silent ranking corruption hazard. Now we log with the full
  // input shape and rethrow so the boundary (controller / job) can decide
  // whether to fail the request or skip the entry explicitly.
  try {
    let totalPoints = currentPoints;
    const seenGames = new Set();

    for (const path of futureGames) {
      for (let i = 0; i < path.length; i++) {
        const game = path[i];
        if (game === "W") continue;
        if (seenGames.has(game)) break;

        seenGames.add(game);
        const roundConfig = TOURNAMENT_ROUNDS[i + 1];
        if (roundConfig) {
          totalPoints += roundConfig.roundPoints || 0;
        }
      }
    }
    return totalPoints;
  } catch (error) {
    Logger.error("getFuturePoints failed", {
      message: error?.message,
      currentPoints,
      futureGamesLength: Array.isArray(futureGames) ? futureGames.length : null,
    });
    throw error;
  }
}

function calculateTeamFuturePoints(teamGames) {
  let points = 0;
  for (let index = 0; index < teamGames.length; index++) {
    const game = teamGames[index];
    const roundConfig = TOURNAMENT_ROUNDS[index + 1];
    if (game !== "W" && roundConfig) {
      points += roundConfig.roundPoints || 0;
    }
  }
  return Number(points);
}

function removeDuplicateGames(futureGames) {
  const seenGames = new Set();
  const cleanedGames = [];

  for (const path of futureGames) {
    const cleanedPath = [];
    for (const game of path) {
      if (game === "W") {
        cleanedPath.push(game);
      } else {
        if (seenGames.has(game)) {
          break;
        }
        seenGames.add(game);
        cleanedPath.push(game);
      }
    }
    cleanedGames.push(cleanedPath);
  }

  return cleanedGames;
}

async function updatePointsForAffectedEntries(year, affectedSIDs) {
  const [activeGames, affectedEntries, allTeams] = await Promise.all([
    gameRepository.getActiveAndFutureGames(year),
    gameRepository.getEntriesContainingTeams(year, affectedSIDs),
    gameRepository.getTournamentTeams(year),
  ]);

  if (affectedEntries.length === 0) return;

  const maps = buildLookupMaps(allTeams, activeGames);

  const pointsArray = affectedEntries.map((entry) => {
    const { currentPoints, maxPoints, futureGamePaths } =
      calculateEntryPointsAndPaths(entry.picks, allTeams, activeGames, maps);
    return {
      entryID: Number(entry.id),
      points: Number(currentPoints),
      possPoints: Number(maxPoints),
      futureGames: futureGamePaths,
      name: entry.teamName,
      groupName: entry.group,
    };
  });

  const chunkSize = APP_CONFIG.tournament.chunkSize;
  for (let i = 0; i < pointsArray.length; i += chunkSize) {
    await entryRepository.updateMultipleEntryPoints(pointsArray.slice(i, i + chunkSize), year);
  }
}

export {
  updatePossiblePoints,
  updatePointsForAffectedEntries,
  getFuturePoints,
  findNextGameId,
  getTournamentData,
  possibleRanking,
  calculateEntryPointsAndPaths,
  enrichEntriesWithPotentialRankings,
  getNextFutureGame,
  removeDuplicateGames,
  calculateTeamFuturePoints,
  minPoints,
  getHighestPlace,
};
