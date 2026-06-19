import {
  tourneyRepository as _tourneyRepository,
  gameRepository as _gameRepository,
  entryRepository as _entryRepository,
  conferenceRepository as _conferenceRepository,
} from "../repositories/index.js";
import Logger from "../utils/logger.js";
import { ValidationError } from "../utils/errors.js";
import pLimit from "p-limit";

let tourneyRepository = _tourneyRepository;
let gameRepository = _gameRepository;
let entryRepository = _entryRepository;
let conferenceRepository = _conferenceRepository;

function setRepositories(newTourneyRepository, newGameRepository, newEntryRepository, newConferenceRepository) {
  tourneyRepository = newTourneyRepository;
  gameRepository = newGameRepository;
  entryRepository = newEntryRepository;
  conferenceRepository = newConferenceRepository;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bracket Structure Tables (S1)
//
// These arrays encode the fixed topology of an NCAA tournament bracket. A full
// bracket has 32 first-round games (one entry per game in BRACKET_R1_NEXT_GAME)
// and 31 subsequent games — 28 per-region (R2–R5) plus 3 inter-region (R5 East-
// West, R5 South-Midwest, R6 Championship) — represented in the four parallel
// arrays BRACKET_R2PLUS_*. Indices in those four arrays MUST line up by game.
//
// gameID scheme (matches data/seed/games.YYYY.json and the live data):
//   Region 1: R1 = 1–8,   R2 = 9–12,   R3 = 13–14,  R4 = 15
//   Region 2: R1 = 16–23, R2 = 24–27,  R3 = 28–29,  R4 = 30
//   Region 3: R1 = 31–38, R2 = 39–42,  R3 = 43–44,  R4 = 45
//   Region 4: R1 = 46–53, R2 = 54–57,  R3 = 58–59,  R4 = 60
//   Inter-region: R5 = 61, 62 (Final Four), R6 = 63 (Championship)
// ─────────────────────────────────────────────────────────────────────────────

// One entry per R1 game (32 total), mapping that R1 game to its R2 nextGameID.
// Duplicates are intentional — two R1 games feed into one R2 game.
const BRACKET_R1_NEXT_GAME = [
  9,  9,  10, 10, 11, 11, 12, 12,   // Region 1
  24, 24, 25, 25, 26, 26, 27, 27,   // Region 2
  39, 39, 40, 40, 41, 41, 42, 42,   // Region 3
  54, 54, 55, 55, 56, 56, 57, 57,   // Region 4
];

// Indexed by a single sequential counter; each i-th index across the four
// BRACKET_R2PLUS_* arrays describes the same downstream game.
const BRACKET_R2PLUS_GAME_ID = [
  9, 10, 11, 12, 13, 14, 15,        // Region 1 R2-R4
  24, 25, 26, 27, 28, 29, 30,       // Region 2 R2-R4
  39, 40, 41, 42, 43, 44, 45,       // Region 3 R2-R4
  54, 55, 56, 57, 58, 59, 60,       // Region 4 R2-R4
  61, 62, 63,                       // Final Four + Championship
];
const BRACKET_R2PLUS_NEXT_GAME = [
  13, 13, 14, 14, 15, 15, 61,
  28, 28, 29, 29, 30, 30, 61,
  43, 43, 44, 44, 45, 45, 62,
  58, 58, 59, 59, 60, 60, 62,
  63, 63, 0,                        // Championship (gameID 63) terminates at 0
];
const BRACKET_R2PLUS_ROUND = [
  2, 2, 2, 2, 3, 3, 4,
  2, 2, 2, 2, 3, 3, 4,
  2, 2, 2, 2, 3, 3, 4,
  2, 2, 2, 2, 3, 3, 4,
  5, 5, 6,
];
const BRACKET_R2PLUS_NEXT_SPOT = [
  1, 2, 1, 2, 1, 2, 1,
  1, 2, 1, 2, 1, 2, 2,
  1, 2, 1, 2, 1, 2, 1,
  1, 2, 1, 2, 1, 2, 2,
  1, 2, null,                       // Championship has no next game
];

// regionID assigned to each of the three inter-region games (Final Four + Championship).
const BRACKET_INTER_REGION_IDS = [5, 5, 6];

const R1_GAME_COUNT = BRACKET_R1_NEXT_GAME.length;       // 32
const R2PLUS_GAME_COUNT = BRACKET_R2PLUS_GAME_ID.length; // 31
const PER_REGION_R2PLUS = 7;                             // R2–R5 within a region
const INTER_REGION_COUNT = 3;                            // F4 (×2) + Championship

// Fail-fast invariant: all R2+ parallel arrays must agree on length, or the
// per-game indexing below will silently corrupt the bracket structure.
if (
  BRACKET_R2PLUS_NEXT_GAME.length !== R2PLUS_GAME_COUNT ||
  BRACKET_R2PLUS_ROUND.length !== R2PLUS_GAME_COUNT ||
  BRACKET_R2PLUS_NEXT_SPOT.length !== R2PLUS_GAME_COUNT ||
  BRACKET_INTER_REGION_IDS.length !== INTER_REGION_COUNT
) {
  throw new Error(
    "tourneyService bracket tables are inconsistent — BRACKET_R2PLUS_* arrays must all have length " +
    `${R2PLUS_GAME_COUNT} and BRACKET_INTER_REGION_IDS must have length ${INTER_REGION_COUNT}`
  );
}
async function prepareRegionVerifyData(regions, year) {
  // Use the master regionID collection so lookup works before the year's subcollection exists
  const allRegionTypes = await tourneyRepository.getAllRegionTypes();

  const regionTypeMap = new Map(
    allRegionTypes.map((r) => [Number(r.regionID), r.regionName])
  );

  const regionNames = regions.map(
    (regionId) => regionTypeMap.get(Number(regionId))
  );

  const [allTeams, conferences] = await Promise.all([
    tourneyRepository.getAllTeams(),
    conferenceRepository.getAllConferences()
  ]);
  const seeds = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];

  return {
    regions,
    regionNames,
    allTeams,
    conferences,
    seeds,
  };
}


function createFutureGameRow(gameID, regionID, year, round, nextGameID, nextSpot) {
  return [
    gameID,
    regionID,
    year,
    null, // team1ID
    null, // team2ID
    null, // winner
    round,
    nextGameID,
    nextSpot,
    null, // team1Seed
    null, // team2Seed
  ];
}

function createNewBracketStructure(gamesData, year, regionArray) {
  const gamesFormat = [];
  const teamRecordFormat = [];
  let nextGameCounter = 0;

  // gamesData entries come in team1/team2 pairs (2 strings per R1 game). The
  // length must be even and cannot exceed twice the number of R1 game slots.
  if (gamesData.length % 2 !== 0) {
    throw new ValidationError(
      `gamesData length must be even (one pair per R1 game), got ${gamesData.length}`,
      "gamesData"
    );
  }
  const r1Pairs = gamesData.length / 2;
  if (r1Pairs > R1_GAME_COUNT) {
    throw new ValidationError(
      `gamesData has ${r1Pairs} R1 games but bracket only supports ${R1_GAME_COUNT}`,
      "gamesData"
    );
  }

  //make the first round for the DB games
  for (let i = 0; i < gamesData.length; i += 2) {
    const [region1, game1, seed1, team1ID] = gamesData[i].split("-");
    const [region2, game2, seed2, team2ID] = gamesData[i + 1].split("-");
    // Blank teamID means the slot is fed by a First Four game
    const parsedTeam1ID = team1ID ? parseInt(team1ID) : null;
    const parsedTeam2ID = team2ID ? parseInt(team2ID) : null;
    //adds rows for the games table
    gamesFormat.push([
      parseInt(game1), // gameID
      parseInt(region1), // regionID
      parseInt(year), // year
      parsedTeam1ID, // team1ID (null if FF-fed)
      parsedTeam2ID, // team2ID (null if FF-fed)
      null, // winner
      1, // round
      BRACKET_R1_NEXT_GAME[nextGameCounter], // nextGameID
      (nextGameCounter % 2) + 1, // nextGameSpot
      parseInt(seed1), // team1Seed
      parseInt(seed2), // team2Seed
    ]);

    //adds rows for the teamRecord table — skip null (FF-fed) slots
    if (parsedTeam1ID) {
      teamRecordFormat.push({
        sID: parsedTeam1ID,
        year: parseInt(year),
        seed: parseInt(seed1),
        regionID: parseInt(region1),
      });
    }
    if (parsedTeam2ID) {
      teamRecordFormat.push({
        sID: parsedTeam2ID,
        year: parseInt(year),
        seed: parseInt(seed2),
        regionID: parseInt(region2),
      });
    }

    nextGameCounter++;
  }

  //Add the future games for the games table — R2 onward, plus inter-region F4/Championship.
  if (gamesData.length > 0) {
    nextGameCounter = 0;
    regionArray.forEach((reg) => {
      for (let j = 0; j < PER_REGION_R2PLUS; j++) {
        gamesFormat.push(
          createFutureGameRow(
            BRACKET_R2PLUS_GAME_ID[nextGameCounter],
            parseInt(reg),
            parseInt(year),
            BRACKET_R2PLUS_ROUND[nextGameCounter],
            BRACKET_R2PLUS_NEXT_GAME[nextGameCounter],
            BRACKET_R2PLUS_NEXT_SPOT[nextGameCounter]
          )
        );
        nextGameCounter++;
      }
    });
    for (let q = 0; q < INTER_REGION_COUNT; q++) {
      gamesFormat.push(
        createFutureGameRow(
          BRACKET_R2PLUS_GAME_ID[nextGameCounter],
          BRACKET_INTER_REGION_IDS[q],
          parseInt(year),
          BRACKET_R2PLUS_ROUND[nextGameCounter],
          BRACKET_R2PLUS_NEXT_GAME[nextGameCounter],
          BRACKET_R2PLUS_NEXT_SPOT[nextGameCounter]
        )
      );
      nextGameCounter++;
    }
  }
  return {
    gamesFormat,
    teamRecordFormat,
  };
}

const FF_GAME_ID_START = 64;

function getR1RegionIDFromNextGame(nextGameID, regionArray) {
  if (nextGameID >= 1 && nextGameID <= 8) return regionArray[0];
  if (nextGameID >= 16 && nextGameID <= 23) return regionArray[1];
  if (nextGameID >= 31 && nextGameID <= 38) return regionArray[2];
  if (nextGameID >= 46 && nextGameID <= 53) return regionArray[3];
  Logger.warn(`getR1RegionIDFromNextGame: nextGameID ${nextGameID} does not map to any R1 region range`);
  return null;
}

async function createFirstFourGames(firstFourData, year, regionArray) {
  // firstFourData: [{ team1ID, team2ID, seed, nextGameID, nextGameSpot }]
  const games = [];
  const schoolRecords = [];

  firstFourData.forEach((ffGame, idx) => {
    const gameID = FF_GAME_ID_START + idx;
    const r1RegionID = getR1RegionIDFromNextGame(ffGame.nextGameID, regionArray);

    games.push({
      gameID,
      team1ID: ffGame.team1ID,
      team2ID: ffGame.team2ID,
      seed: ffGame.seed,
      nextGameID: ffGame.nextGameID,
      nextGameSpot: ffGame.nextGameSpot,
    });

    schoolRecords.push({ sID: ffGame.team1ID, seed: ffGame.seed, gameID, slot: 1, r1RegionID });
    schoolRecords.push({ sID: ffGame.team2ID, seed: ffGame.seed, gameID, slot: 2, r1RegionID });
  });

  await tourneyRepository.insertFirstFourGames(games, year);
  await tourneyRepository.insertFirstFourSchoolRecords(schoolRecords, year);
}

async function createNewBracket(gamesData, year, regionArray, firstFourData = null) {
  const { gamesFormat, teamRecordFormat } = await createNewBracketStructure(
    gamesData,
    year,
    regionArray
  );
  const gamesWithoutTeams = gamesFormat.filter(
    (game) => game[3] === null && game[4] === null
  );
  // Includes fully-filled games and partially-filled R1 games where one slot is FF-fed (null)
  const gamesWithTeams = gamesFormat.filter(
    (game) => game[3] !== null || game[4] !== null
  );

  // Write the year's regions subcollection from the master regionID collection.
  // Also include the Final Four (5) and Championship (6) regions.
  const allRegionIDs = [...regionArray, 5, 6];
  await tourneyRepository.insertRegionsForYear(year, allRegionIDs);
  await tourneyRepository.insertMultipleGamesWithoutTeams(gamesWithoutTeams);
  await tourneyRepository.insertMultipleGamesWithTeams(gamesWithTeams);
  await tourneyRepository.insertMultipleSchoolRecords(teamRecordFormat);

  if (firstFourData && firstFourData.length > 0) {
    await createFirstFourGames(firstFourData, year, regionArray);
    await tourneyRepository.upsertTournamentDoc(year, {
      hasFirstFour: true,
      firstFourGameCount: firstFourData.length,
    });
  } else {
    await tourneyRepository.upsertTournamentDoc(year);
  }
}

async function getAllGames(year) {
  return await gameRepository.getActiveAndFutureGames(year);
}

async function updateBracket(gamesData, year, regionArray) {
  const { gamesFormat, teamRecordFormat } = await createNewBracketStructure(
    gamesData,
    year,
    regionArray
  );
  const gamesWithoutTeams = gamesFormat.filter(
    (game) => game[3] === null && game[4] === null
  );
  // Includes fully-filled games and partially-filled R1 games where one slot is FF-fed (null)
  const gamesWithTeams = gamesFormat.filter(
    (game) => game[3] !== null || game[4] !== null
  );

  //determine which schools have changed
  const existingRecords = await tourneyRepository.getSchoolRecordsForYear(year);

  const existingSIDs = existingRecords.map((rec) => rec.sID);
  const newSIDs = teamRecordFormat.map((rec) => rec.sID);
  const existingSIDsSet = new Set(existingSIDs);
  const newSIDsSet = new Set(newSIDs);
  const sIDsToAdd = newSIDs.filter((sid) => !existingSIDsSet.has(sid));
  const sIDsToRemove = existingSIDs.filter((sid) => !newSIDsSet.has(sid));

  // A balanced add/remove set is required so every pick on a removed school
  // can be migrated to a specific replacement. An imbalance means the producer
  // built an inconsistent bracket — fail loudly rather than silently dropping
  // either trailing removes (data loss) or trailing adds (orphaned schools).
  if (sIDsToAdd.length !== sIDsToRemove.length) {
    throw new ValidationError(
      `Bracket school change count mismatch for year ${year}: ${sIDsToAdd.length} additions vs ${sIDsToRemove.length} removals. Each new school must replace exactly one removed school.`,
      "sIDChanges"
    );
  }

  const sIDChanges = [];
  for (let i = 0; i < sIDsToAdd.length; i++) {
    sIDChanges.push([sIDsToAdd[i], sIDsToRemove[i]]);
  }

  await tourneyRepository.updateMultipleGamesWithTeams(gamesWithTeams);
  await tourneyRepository.updateMultipleSchoolRecords(teamRecordFormat);
  return sIDChanges;
}

async function updateEntrywithNewSchools(schoolChanges, year) {
  // schoolChanges is an array of [addSID, removeSID]
  const removeSIDs = schoolChanges.map(([, removeSID]) => removeSID).filter(Boolean);
  if (removeSIDs.length === 0) return;

  const affectedEntries = await gameRepository.getEntriesContainingTeams(year, removeSIDs);
  if (affectedEntries.length === 0) return;

  const limit = pLimit(5);
  await Promise.all(
    affectedEntries.map((entry) =>
      limit(() => entryRepository.updateEntryPicksWithSwaps(entry.id, schoolChanges, year))
    )
  );
}

async function prepareNewTournamentData() {
  const [allRegionTypes, allTeams, conferences] = await Promise.all([
    tourneyRepository.getAllRegionTypes(),
    tourneyRepository.getAllTeams(),
    conferenceRepository.getAllConferences(),
  ]);
  const seeds = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];
  // Only expose bracket regions (1–4); Final Four / Championship / First Four are not selectable
  const bracketRegions = allRegionTypes.filter((r) => Number(r.regionID) >= 1 && Number(r.regionID) <= 4);
  return { allRegionTypes: bracketRegions, allTeams, conferences, seeds };
}

async function deleteTournament(year) {
  await tourneyRepository.deleteGamesByYear(year);
  await tourneyRepository.deleteSchoolRecordsByYear(year);
  await tourneyRepository.deleteRegionsByYear(year);
  await tourneyRepository.deleteTournamentDoc(year);
}

export {
  setRepositories,
  prepareRegionVerifyData,
  prepareNewTournamentData,
  createNewBracketStructure,
  createNewBracket,
  createFirstFourGames,
  getAllGames,
  updateBracket,
  updateEntrywithNewSchools,
  deleteTournament,
};
