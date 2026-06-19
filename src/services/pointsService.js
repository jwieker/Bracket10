import {
  getHighestPlace,
  minPoints,
  getFuturePoints,
} from "../utils/pointsUtils.js";
import { TOURNAMENT_ROUNDS, APP_CONFIG, thisYear } from "../config/app.js";
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
import pLimit from "p-limit";


// Firestore caps a single batch at 500 write operations. updateMultipleEntryPoints
// emits exactly one write per entry, so we can chunk by entry count up to 500.
const MAX_BATCH_SIZE = 500;


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

function mapEntryToPointsData(entry, allTeams, activeGames, maps) {
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

  // Belt-and-suspenders dedupe: a duplicated pick would double-count its
  // cumulative points below and fabricate a head-to-head "clash" in minPoints
  // (two identical paths read as a guaranteed-advance pair). Entry create/update
  // flows reject duplicates, but corrupted or legacy data must not skew scoring.
  const uniquePicks = picks ? [...new Set(picks)] : [];

  let currentPoints = 0;
  const futureGamePaths = [];

  for (const pickId of uniquePicks) {
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

  const pointsArray = allEntries.map((entry) =>
    mapEntryToPointsData(entry, allTeams, activeGames, maps)
  );

  const chunkSize = MAX_BATCH_SIZE;
  const chunks = [];
  for (let i = 0; i < pointsArray.length; i += chunkSize) {
    chunks.push(pointsArray.slice(i, i + chunkSize));
  }

  const totalStartTime = Date.now();

  const limit = pLimit(5);
  await Promise.all(
    chunks.map((chunk, index) => limit(async () => {
      const startTime = Date.now();
      Logger.info(
        `Updating chunk number ${index} of total chunks ${chunks.length} for year ${year}`
      );
      await entryRepository.updateMultipleEntryPoints(chunk, year);
      const duration = Date.now() - startTime;
      Logger.performance(`Chunk update`, duration);
    }))
  );

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

  const sortedGames = [...activeGamesData].sort((a, b) => (a.round || 0) - (b.round || 0));
  const incomingGames = new Map();
  for (const g of activeGamesData) {
    if (g.nextGameID) {
      if (!incomingGames.has(g.nextGameID)) {
        incomingGames.set(g.nextGameID, []);
      }
      incomingGames.get(g.nextGameID).push(g.gameID);
    }
  }

  // Single pass: compute points, paths, pickSet, and minPoints together
  const enrichedEntries = entriesToEnrich.map((entry) => {
    // Dedupe picks here too, because getHighestPlace pairs entry.picks[i] with
    // entry.futureGames[i] by index. calculateEntryPointsAndPaths returns
    // futureGamePaths deduped, so picks/pickSet must dedupe identically (same
    // insertion order) or the index-coupling desyncs on corrupted data (#157).
    const picks = entry.picks ? [...new Set(entry.picks)] : [];
    const { currentPoints, maxPoints, futureGamePaths } =
      calculateEntryPointsAndPaths(picks, allTeamsData, activeGamesData, maps);

    return {
      ...entry,
      picks,
      entryID: Number(entry.id || entry.entryID),
      name: entry.teamName || entry.name,
      points: Number(currentPoints),
      maxPoints: Number(maxPoints),
      futureGames: futureGamePaths,
      pickSet: new Set(picks),
      minPoints: minPoints(futureGamePaths, Number(currentPoints), sortedGames, incomingGames),
    };
  });

  // Calculate highest possible place for each entry
  const otherMinCaches = new Map();
  for (const entry of enrichedEntries) {
    const { highestPlace, ties } = getHighestPlace(entry, enrichedEntries, otherMinCaches, sortedGames, incomingGames);
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


/**
 * Calculates the minimum guaranteed points for an entry.
 */

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


async function updatePointsForAffectedEntries(year, affectedSIDs) {
  const [activeGames, affectedEntries, allTeams] = await Promise.all([
    gameRepository.getActiveAndFutureGames(year),
    gameRepository.getEntriesContainingTeams(year, affectedSIDs),
    gameRepository.getTournamentTeams(year),
  ]);

  if (affectedEntries.length === 0) return;

  const maps = buildLookupMaps(allTeams, activeGames);

  const pointsArray = affectedEntries.map((entry) =>
    mapEntryToPointsData(entry, allTeams, activeGames, maps)
  );

  const chunkSize = MAX_BATCH_SIZE;
  const chunks = [];
  for (let i = 0; i < pointsArray.length; i += chunkSize) {
    chunks.push(pointsArray.slice(i, i + chunkSize));
  }

  const limit = pLimit(5);
  await Promise.all(
    chunks.map((chunk) => limit(() => entryRepository.updateMultipleEntryPoints(chunk, year)))
  );
}

export {
  getFuturePoints,
  minPoints,
  updatePossiblePoints,
  updatePointsForAffectedEntries,
  findNextGameId,
  getTournamentData,
  possibleRanking,
  calculateEntryPointsAndPaths,
  enrichEntriesWithPotentialRankings,
  getNextFutureGame,
};
