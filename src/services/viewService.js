import {
  viewRepository as _viewRepository,
  gameRepository as _gameRepository,
  entryRepository as _entryRepository,
  tourneyRepository as _tourneyRepository,
} from "../repositories/index.js";

import {
  calculateEntryPointsAndPaths,
  enrichEntriesWithPotentialRankings,
} from "./pointsService.js";

import { thisYear, TOURNAMENT_ROUNDS, isRegistrationOpen } from "../config/app.js";
import { cacheGet, cacheSet } from "../utils/cacheUtils.js";
import Logger from "../utils/logger.js";
import { randomInt } from "node:crypto";


export {
  getGroupTeamDetails,
  addTeamProgressforGroup,
  verifyGroupExists,
  getGroupRegistrationData,
  createNewEntry,
  addPickCount,
  calculateMaxPossiblePoints,
  getAllYearsforGroup,
  getEntriesForUser,
  getEntryIdsForUserInGroup,
  getRegionsForYear,
  findEntriesByName,
  addNewGroup,
  getRegionIDForYear,
  normalizeFirstFourPicks,
  setRepositories,
  buildFullGridData,
  buildGameViewData,
};

let viewRepository = _viewRepository;
let gameRepository = _gameRepository;
let entryRepository = _entryRepository;
let tourneyRepository = _tourneyRepository;

async function getGroupTeamDetails(groupName, year = thisYear, prefetchedTeams = null) {
  const [groupTeams, resultsSoFar] = await Promise.all([
    viewRepository.getGroupTeams(groupName, year),
    // Skip DB fetch if the caller already has the tournament details
    prefetchedTeams ? Promise.resolve(prefetchedTeams) : gameRepository.getAllTournamentDetails(year).then(d => d.teams),
  ]);

  if (!groupTeams) {
    return [[], resultsSoFar];
  }

  const teamMap = new Map(resultsSoFar.map((t) => [t.sID, t]));
  const mappedGroupTeams = groupTeams.map((team) => ({
    ...team,
    pickNames: team.picks.map((pickId) => teamMap.get(pickId)).filter(Boolean),
  }));

  return [mappedGroupTeams, resultsSoFar];
}

//Adds the progress of each team in a Group to the groupTeams array
//does not take in a year it just needs output of getAllGroupDetails
async function addTeamProgressforGroup(groupTeams, allTournamentTeams) {
  const pointsPerRound = Object.entries(TOURNAMENT_ROUNDS)
    .filter(([round]) => Number(round) > 0)
    .map(([, r]) => r.roundPoints);

  // Determine the global tournament round state using ALL teams (not just one person's picks).
  // This way, everyone shows as "advanced" until the first game of the next round has started.
  let globalMinActiveLen = Infinity;
  let globalMaxActiveLen = 0;
  if (allTournamentTeams) {
    for (const team of allTournamentTeams) {
      const gs = team.gameStatus;
      if (gs == null || gs.length === 0) {
        globalMinActiveLen = Math.min(globalMinActiveLen, 0);
      } else if (gs[gs.length - 1] !== 'L') {
        globalMinActiveLen = Math.min(globalMinActiveLen, gs.length);
        globalMaxActiveLen = Math.max(globalMaxActiveLen, gs.length);
      }
    }
  }
  const globalRoundInProgress = globalMaxActiveLen > globalMinActiveLen;

  for (const team of groupTeams) {
    const pickNames = team.pickNames || [];
    // Per-round counters: [wins, losses, toPlay, roundPoints] indexed by round (0..5).
    const picksProgress = Array.from({ length: 6 }, () => [0, 0, 0, 0]);
    let teamsRemaining = 10; //counts down from 10 when it finds a loss

    for (let j = 0; j < pickNames.length; j++) {
      const pick = pickNames[j];
      const gs = pick?.gameStatus;
      if (gs == null) {
        picksProgress[j][2]++;
        continue;
      }
      let pickPoints = 0;
      for (let t = 0; t < gs.length; t++) {
        if (gs[t] === "W") {
          picksProgress[t][0]++;
          pickPoints += pointsPerRound[t];
          picksProgress[t][3] += pointsPerRound[t];
          // After a win, the pick advances to the next round's "toPlay" tally,
          // unless this was the championship win (t === 5, no t+1 round exists).
          if (t + 1 === gs.length && t !== 5) {
            picksProgress[t + 1][2]++;
          }
        } else if (gs[t] === "L") {
          picksProgress[t][1]++;
          teamsRemaining--;
        }
      }
      pick.pickPoints = pickPoints;
    }

    // Determine teamsAdvanced using the GLOBAL tournament round state.
    // If the global round is in progress (some teams in the tournament have played more games
    // than others), count this person's picks that have won in the current round.
    // If the global round is NOT in progress (all alive teams tournament-wide have the same
    // gameStatus length), then everyone's remaining teams count as "advanced" — they all
    // made it through the completed round and the next round hasn't started yet.
    let teamsAdvanced = 0;
    if (globalRoundInProgress) {
      for (const pick of pickNames) {
        const gs = pick?.gameStatus;
        if (gs != null && gs.length === globalMaxActiveLen && gs[gs.length - 1] === 'W') {
          teamsAdvanced++;
        }
      }
    }

    team.picksProgress = picksProgress;
    team.teamsRemaining = teamsRemaining;
    team.teamsAdvanced = teamsAdvanced;
  }
  return groupTeams;
}

async function verifyGroupExists(groupName) {
  return await viewRepository.findGroupByName(groupName);
}

async function getGroupRegistrationData(groupName, year = thisYear) {
  // Single consolidated fetch — replaces separate getTournamentTeams + getActiveAndFutureGames calls
  const [{ teams: allTeams, allGames, regions }, groupTeams] = await Promise.all([
    gameRepository.getAllTournamentDetails(year),
    viewRepository.getGroupTeams(groupName, year),
  ]);

  // Build combined FF display: remove individual FF teams, add combined or resolved options
  const ffGames = allGames.filter(g => g.round === 0);
  const ffTeamSIDs = new Set();
  const ffWinnerSIDs = new Set();
  const combinedFFOptions = [];

  // Pre-build map of allTeams for O(1) lookup
  const teamMap = new Map();
  for (const t of allTeams || []) {
    teamMap.set(t.sID, t);
  }

  for (const ffGame of ffGames) {
    ffTeamSIDs.add(ffGame.team1ID);
    ffTeamSIDs.add(ffGame.team2ID);

    if (!ffGame.winner) {
      // Unresolved FF: create combined option using team1's sID as the pick value
      const team1 = teamMap.get(ffGame.team1ID);
      const team2 = teamMap.get(ffGame.team2ID);
      if (team1 && team2) {
        combinedFFOptions.push({
          sID: team1.sID,
          nameNick: `${team1.nameNick} / ${team2.nameNick}`,
          mascot: "First Four",
          seed: team1.seed,
          regionName: team1.regionName,
          isFirstFour: true,
          ffPartnerSID: team2.sID,
        });
      }
    } else {
      // Resolved FF: track winner so their canonical doc passes through the filter below
      ffWinnerSIDs.add(ffGame.winner);
    }
  }

  // After FF resolution, allTeams contains two docs for the winner: the ff_ doc and the
  // canonical {regionID}_{seed} doc. Keep only the canonical doc (isFFDoc === false).
  // Exclude all other FF team docs (losers).
  const seenSIDs = new Map(); // sID -> best team entry
  for (const t of allTeams) {
    if (!ffTeamSIDs.has(t.sID)) {
      // Normal team — always include
      seenSIDs.set(t.sID, t);
    } else if (ffWinnerSIDs.has(t.sID) && !t.isFFDoc) {
      // Resolved FF winner's canonical doc — include, skip the ff_ doc
      seenSIDs.set(t.sID, t);
    }
    // FF losers and ff_ docs for winners: skip
  }

  // Add combined options for unresolved FF games, then re-sort to keep seed order intact.
  const teamData = [
    ...seenSIDs.values(),
    ...combinedFFOptions,
  ].sort((a, b) => {
    if (a.seed !== b.seed) return a.seed - b.seed;
    return (a.regionName || '').localeCompare(b.regionName || '');
  });

  return {
    name: groupName,
    teamData,
    gameData: allGames,
    regions,
    groupTeams,
  };
}

/**
 * Normalizes First Four picks against LIVE game state at write time, so an
 * entry always stores the value the pick-swap machinery would converge to:
 *
 *   game unresolved → team1ID  (the combined "A / B" option's value)
 *   game resolved   → winner   (regardless of which FF team was submitted)
 *
 * This is what makes "whoever you pick, you get the winner" unconditional:
 * a submission from a stale form (rendered before the game resolved) or
 * validated against the 300s-cached registration team list still lands on
 * the correct sID, instead of stranding the entry on an eliminated team.
 * Reads the round-0 games uncached (≤4 tiny docs) for exactly that reason.
 *
 * Non-FF picks pass through untouched. Returns a new array.
 */
async function normalizeFirstFourPicks(picksIds, year = thisYear) {
  const ffGames = await gameRepository.getFirstFourGames(year);
  if (!ffGames || ffGames.length === 0) return [...picksIds];

  const ffTarget = new Map(); // any FF-team sID → the sID the pick should store
  for (const game of ffGames) {
    const team1 = Number(game.team1ID);
    const team2 = Number(game.team2ID);
    const target = game.winner != null ? Number(game.winner) : team1;
    if (Number.isFinite(team1)) ffTarget.set(team1, target);
    if (Number.isFinite(team2)) ffTarget.set(team2, target);
  }

  return picksIds.map((pick) => {
    const id = Number(pick);
    return ffTarget.has(id) ? ffTarget.get(id) : pick;
  });
}

// Entry IDs gate access to an entry in /my-entry. A timestamp-based id
// (Date.now() + small random) is guessable: its entropy is only the
// registration window, so an attacker who knows roughly when someone signed
// up can enumerate it. We instead use a cryptographically-random integer with
// ~48 bits of entropy — unrelated to time and effectively unguessable. It
// stays a Number so existing numeric handling (Number(entryId), arithmetic)
// keeps working.
const MIN_ENTRY_ID = 100_000_000_000; // 1e11, keeps ids a consistent length
const MAX_ENTRY_ID = 281_474_976_710_655; // 2**48 - 1 (crypto.randomInt ceiling)

async function generateUniqueEntryId(year) {
  // Random ids have no built-in uniqueness, so verify the id is free before
  // using it. Collisions are astronomically unlikely, so a few retries is
  // plenty; registration is infrequent, so the extra read is cheap.
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = randomInt(MIN_ENTRY_ID, MAX_ENTRY_ID);
    const existing = await gameRepository.getEntryById(candidate, year);
    if (!existing) return candidate;
  }
  throw new Error("Could not generate a unique entry ID after multiple attempts.");
}

async function createNewEntry(email, teamName, personName, groupName, picks, year = thisYear, maxPoints = 0) {
  const newId = await generateUniqueEntryId(year);
  const nowEST = new Date().toISOString();

  // Canonicalize the email on write so it matches the lowercased session email
  // used for "My Brackets" lookups (getEntriesByEmail) and case-insensitive
  // ownership checks. Email addresses are case-insensitive in practice, so this
  // is safe for delivery too.
  const normalizedEmail = String(email || '').trim().toLowerCase();

  await entryRepository.createEntry(
    newId,
    normalizedEmail,
    teamName,
    picks,
    groupName,
    personName,
    nowEST,
    year,
    maxPoints
  );
}

async function addPickCount(allTeams, groupData) {
  const pickCounts = new Map();
  for (const entry of groupData) {
    for (const sID of entry.picks) {
      pickCounts.set(sID, (pickCounts.get(sID) ?? 0) + 1);
    }
  }
  for (const team of allTeams) {
    team.pickCount = pickCounts.get(team.sID) ?? 0;
  }
  return allTeams;
}

/**
 * Calculates the maximum possible points for a given set of team picks (for registration).
 */
async function calculateMaxPossiblePoints(teamSIDs, inputYear = thisYear) {
  try {
    // Single consolidated fetch replaces separate getActiveAndFutureGames + getTournamentTeams calls
    const { allGames, teams: allTeams } = await gameRepository.getAllTournamentDetails(inputYear);

    const picks = teamSIDs.map((sid) => Number(sid)).filter((id) => !isNaN(id));

    if (picks.length !== teamSIDs.length) {
      Logger.warn("Some invalid SIDs were provided and filtered out.");
    }
    if (picks.length === 0) {
      Logger.warn("No valid SIDs provided.");
      return 0;
    }

    const { maxPoints } = calculateEntryPointsAndPaths(picks, allTeams, allGames);

    return maxPoints;
  } catch (error) {
    Logger.error("Error in calculateMaxPossiblePoints service:", error);
    throw new Error("Failed to calculate maximum possible points.");
  }
}

async function getAllYearsforGroup(groupName) {
  const allYears = await gameRepository.getAllYearsForGroup(groupName);
  return allYears.map((year) => year.year);
}

/**
 * getEntriesForUser — shapes a signed-in participant's entries (matched by their
 * verified Google email, across all years) for the "My Brackets" dashboard.
 * Normalizes the legacy singular `group` field into a `groups` array and derives
 * an `editable` flag from the shared registration window (isRegistrationOpen()).
 */
async function getEntriesForUser(email) {
  const windowOpen = isRegistrationOpen();
  const entries = await gameRepository.getEntriesByEmail(email);
  return entries.map((e) => {
    const groups = Array.isArray(e.groups)
      ? e.groups
      : (e.group ? [e.group] : []);
    return {
      id: e.id,
      year: e.year,
      person: e.person,
      teamName: e.teamName,
      groups,
      totalPoints: e.totalPoints ?? 0,
      possPoints: e.possPoints ?? 0,
      // Editable only for the current tournament year, within the open window.
      editable: windowOpen && e.year === thisYear,
      viewGroup: groups[0] || null,
    };
  });
}

/**
 * getEntryIdsForUserInGroup — entry IDs (as strings) belonging to the signed-in
 * participant within a specific group + year. Used to highlight "your" rows on
 * the public results page by matching email on the SERVER and passing only IDs
 * to the view, so no participant's email is ever exposed on that public page.
 */
async function getEntryIdsForUserInGroup(email, groupName, year) {
  if (!email) return [];
  const yr = Number(year);
  // Scope to the requested year — this runs on the (cached) results page for
  // every signed-in visitor, so avoid scanning all tournament years.
  const entries = await gameRepository.getEntriesByEmail(email, yr);
  return entries
    .filter((e) => {
      if (e.year !== yr) return false;
      const groups = Array.isArray(e.groups) ? e.groups : (e.group ? [e.group] : []);
      return groups.includes(groupName);
    })
    .map((e) => String(e.id));
}

/**
 * Returns the 4 bracket region IDs for a given year.
 * Reads directly from the regions subcollection.
 */
async function getRegionIDForYear(year) {
  const allRegions = await tourneyRepository.getAllRegions(year);
  return allRegions.map((r) => r.regionID);
}

/**
 * Returns the 4 bracket region names for a given year.
 * Now a local derivation from getAllTournamentDetails — no extra DB read.
 */
async function getRegionsForYear(year) {
  const { regions } = await gameRepository.getAllTournamentDetails(year);
  // regions is already an array of 4 { regionID, regionName } objects
  return regions.map((r) => r.regionName);
}

async function findEntriesByName(name, year = thisYear) {
  const entries = await entryRepository.findEntriesByName(name, year);
  return entries;
}

async function addNewGroup(groupName) {
  const maxId = await viewRepository.getMaxGroupId();
  const newId = (maxId || 0) + 1;
  await viewRepository.addGroup(newId, groupName);
}

function setRepositories(newViewRepository, newGameRepository, newEntryRepository, newTourneyRepository) {
  viewRepository = newViewRepository;
  gameRepository = newGameRepository;
  entryRepository = newEntryRepository;
  if (newTourneyRepository) tourneyRepository = newTourneyRepository;
}

/**
 * Builds all the necessary data for the full grid view.
 */
async function buildFullGridData(groupName, gameYear, prefetchedDetails = null) {
  const [{ allGames: activeGamesForYear, teams: allTeamsRawFull }, groupTeamsRaw] = await Promise.all([
    prefetchedDetails
      ? Promise.resolve(prefetchedDetails)
      : gameRepository.getAllTournamentDetails(gameYear),
    viewRepository.getGroupTeams(groupName, gameYear),
  ]);

  // Exclude FF losers and ff_ docs (duplicate entries for FF winners) from grid columns.
  // For unresolved FF games, build a combined "Team A / Team B" entry to use as the column.
  const ffLoserSIDs = new Set();
  const combinedFFOptions = [];

  const teamMapRawFull = new Map();
  for (const t of allTeamsRawFull) {
    teamMapRawFull.set(t.sID, t);
  }

  for (const g of activeGamesForYear) {
    if (g.round === 0) {
      if (g.winner) {
        ffLoserSIDs.add(g.winner === g.team1ID ? g.team2ID : g.team1ID);
      } else {
        const team1 = teamMapRawFull.get(g.team1ID);
        const team2 = teamMapRawFull.get(g.team2ID);
        if (team1 && team2) {
          combinedFFOptions.push({
            ...team1,
            nameNick: `${team1.nameNick} / ${team2.nameNick}`,
            mascot: 'First Four',
            isFirstFour: true,
            ffPartnerSID: team2.sID,
          });
        }
      }
    }
  }
  const allTeamsRaw = [
    ...allTeamsRawFull.filter(t => !ffLoserSIDs.has(t.sID) && !t.isFFDoc),
    ...combinedFFOptions,
  ].sort((a, b) => {
    if (a.seed !== b.seed) return a.seed - b.seed;
    return (a.regionName || '').localeCompare(b.regionName || '');
  });

  const teamMapFull = new Map(allTeamsRaw.map((t) => [t.sID, t]));

  // Map the FF partner sID to the same combined object so picks for either team resolve correctly.
  combinedFFOptions.forEach(opt => teamMapFull.set(opt.ffPartnerSID, opt));
  const allGroupDetails = (groupTeamsRaw || []).map((team) => {
    const pickNames = team.picks.map((pickId) => teamMapFull.get(pickId)).filter(Boolean);
    return {
      ...team,
      pickNames,
      // O(1) resolved-sID -> 1-based position within pickNames. Consumed by
      // fullGrid.ejs to avoid a per-cell linear scan over picks (the render was
      // O(entries × teams × picks)). Keyed off the resolved pickNames sIDs so FF
      // partner picks remap to their combined column, matching the old findIndex.
      pickIndexBySID: new Map(pickNames.map((pick, i) => [pick.sID, i + 1])),
    };
  });

  let groupData = await addTeamProgressforGroup(allGroupDetails, allTeamsRaw);
  const allTeamsWithPickCounts = await addPickCount(allTeamsRaw, groupData);

  groupData = await enrichEntriesWithPotentialRankings(
    groupData,
    allTeamsRaw,
    activeGamesForYear
  );

  groupData.sort((a, b) => {
    if (a.totalPoints !== b.totalPoints) return b.totalPoints - a.totalPoints;
    if (a.teamsRemaining !== b.teamsRemaining) return b.teamsRemaining - a.teamsRemaining;
    return b.possPoints - a.possPoints;
  });

  let currentRank = 0;
  let previousTotalPoints = -1;
  let previousRank = 0;
  let sameRankCount = 0;

  groupData.forEach((group) => {
    if (group.totalPoints === previousTotalPoints) {
      sameRankCount++;
      group.rank = previousRank;
    } else {
      currentRank += sameRankCount + 1;
      sameRankCount = 0;
      group.rank = currentRank;
      previousRank = currentRank;
    }
    previousTotalPoints = group.totalPoints;
  });

  return { groupData, allTeamsWithPickCounts };
}

/**
 * Builds all the necessary data for the game view.
 *
 * Service-level cache (5-min TTL, matching tournamentDetails) skips all join
 * work on warm hits. Invalidated by GameRepository.updateWinner/updateNextGameTeam
 * and EntryRepository.createEntry/deleteEntry.
 *
 * ESPN/conference fields (espnID, logoUrl, primaryColor, conferenceName) are now
 * denormalized into schoolRecords, so no separate allSchools or allConferences
 * fetch is needed here.
 */
async function buildGameViewData(verifiedGroupName, requestedYear) {
  const cacheKey = `gameViewData_${requestedYear}_${verifiedGroupName}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const [{ activeGames: activeGamesForYear, regions, teams: allTeamsRaw }, groupTeamsRaw, allYears] =
    await Promise.all([
      gameRepository.getAllTournamentDetails(requestedYear),
      viewRepository.getGroupTeams(verifiedGroupName, requestedYear),
      getAllYearsforGroup(verifiedGroupName),
    ]);

  const teamMapGame = new Map(allTeamsRaw.map((t) => [t.sID, t]));
  const allGroupDetails = (groupTeamsRaw || []).map((team) => ({
    ...team,
    pickNames: team.picks.map((pickId) => teamMapGame.get(pickId)).filter(Boolean),
  }));

  const enrichedActiveGames = activeGamesForYear.map((game) => {
    if (game.winner) {
      const winnerName = game.winner === game.team1ID ? game.team1Name : game.team2Name;
      return { ...game, winnerName };
    }
    return game;
  });

  // conferenceName is now on each team directly from schoolRecords
  const conferenceStats = {};
  allTeamsRaw.forEach(t => {
    if (t.conferenceName) {
      if (!conferenceStats[t.conferenceName]) conferenceStats[t.conferenceName] = 0;
      conferenceStats[t.conferenceName]++;
    }
  });

  const groupData = await addTeamProgressforGroup(allGroupDetails, allTeamsRaw);
  const regionNames = regions.map((r) => r.regionName);

  const result = {
    groupData,
    enrichedActiveGames,
    allTeamsRaw,
    allYears,
    regionNames,
    conferenceStats,
  };

  // Cache for 5 min — same TTL as tournamentDetails (the shortest-lived input)
  cacheSet(cacheKey, result, 300);
  return result;
}
