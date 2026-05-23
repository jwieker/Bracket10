import { gameRepository as _gameRepository, teamRepository as _teamRepository } from "../repositories/index.js";
import { updateEntrywithNewSchools as _updateEntrywithNewSchools } from "./tourneyService.js";
import { TOURNAMENT_ROUNDS } from "../config/const.js";
import Logger from "../utils/logger.js";

let teamRepository = _teamRepository;
let gameRepository = _gameRepository;
let updateEntrywithNewSchools = _updateEntrywithNewSchools;

function setRepositories(newTeamRepository, newGameRepository, newUpdateEntrywithNewSchools = null) {
  teamRepository = newTeamRepository;
  gameRepository = newGameRepository;
  if (newUpdateEntrywithNewSchools) updateEntrywithNewSchools = newUpdateEntrywithNewSchools;
}
/**
 * Reverts team records when undoing a game result
 * @param {number} winner - The team that was previously marked as winner
 * @param {number} loser - The team that was previously marked as loser
 * @param {number} round - The tournament round number (1-6)
 * @throws {Error} If the round is invalid or database update fails
 */
async function undoTeamRecords(
  winner,
  loser,
  round,
  gameID,
  nextGame,
  nextGameSpot,
  year,
  team1ID = null
) {
  const config = TOURNAMENT_ROUNDS[round];
  if (!config) {
    throw new Error(`Invalid round number: ${round}`);
  }

  if (round === 0) {
    try {
      await gameRepository.updateWinner(gameID, null, year);
      if (nextGame) {
        await gameRepository.updateNextGameTeam(nextGame, nextGameSpot, null, year);
      }
      // Normalize all FF picks back to team1's sID — team1ID is always the canonical pick sID
      // for an unresolved FF game (the combined option in registration uses team1ID).
      // Build swaps: for each sID that isn't team1ID, swap it → team1ID.
      let swaps;
      if (team1ID) {
        swaps = [];
        const team2ID = team1ID === loser ? winner : loser;
        if (winner !== team1ID) swaps.push([team1ID, winner]); // winner was team2; swap back
        if (team2ID !== winner) swaps.push([team1ID, team2ID]); // normalize stale team2 picks
      } else {
        swaps = [[loser, winner]]; // fallback: reverse the resolution swap
      }
      await updateEntrywithNewSchools(swaps, year);
      await teamRepository.deleteCanonicalSchoolRecord(winner, year);
      Logger.info(`[FF] Undone game ${gameID}: restored ${loser}, removed ${winner}`);
    } catch (error) {
      Logger.error("Error undoing FF game records:", error);
      throw error;
    }
    return;
  }

  try {
    if (round === 1) {
      await Promise.all([
        teamRepository.updateTeamRecordWithNulls(winner, year),
        teamRepository.updateTeamRecordWithNulls(loser, year),
        gameRepository.updateWinner(gameID, null, year),
        ...(nextGame ? [gameRepository.updateNextGameTeam(nextGame, nextGameSpot, null, year)] : []),
      ]);
      return;
    }

    const gameArray = Array(config.wins - 1).fill("W");
    await Promise.all([
      teamRepository.updateTeamRecord(
        winner,
        config.loserPoints,
        gameArray,
        year
      ),
      teamRepository.updateTeamRecord(
        loser,
        config.loserPoints,
        gameArray,
        year
      ),
      gameRepository.updateWinner(gameID, null, year),
      ...(nextGame ? [gameRepository.updateNextGameTeam(nextGame, nextGameSpot, null, year)] : []),
    ]);
  } catch (error) {
    Logger.error("Error undoing teams records:", error);
    throw error;
  }
}

/**
 * Updates the team records for the given round
 * @param {*} winner - The team that won the game
 * @param {*} loser  - The team that lost the game
 * @param {*} round - The tournament round number (1-6)
 * @param {number} gameID - The ID of the game being updated
 * @param {number} nextGame - The ID of the next game to update
 * @param {number} nextGameSpot - The spot in the next game where the winner will be placed
 * @throws {Error} If the round is invalid or database update fails
 */
async function updateTeamRecords(
  winner,
  loser,
  round,
  gameID,
  nextGame,
  nextGameSpot,
  year
) {
  const config = TOURNAMENT_ROUNDS[round];
  if (!config) {
    throw new Error(`Invalid tournament round: ${round}`);
  }

  if (round === 0) {
    try {
      await gameRepository.updateWinner(gameID, winner, year);
      if (nextGame) {
        await gameRepository.updateNextGameTeam(nextGame, nextGameSpot, winner, year);
      }
      // Auto-swap all entry picks: loser → winner
      await updateEntrywithNewSchools([[winner, loser]], year);
      await teamRepository.createCanonicalSchoolRecord(winner, year);
      Logger.info(`[FF] Resolved game ${gameID}: winner ${winner}, loser ${loser}`);
    } catch (error) {
      Logger.error("Error updating FF game records:", error);
      throw error;
    }
    return;
  }

  const winArray = Array(config.wins).fill("W");
  const loseArray = [...Array(config.wins - 1).fill("W"), "L"];

  try {
    await Promise.all([
      gameRepository.updateWinner(gameID, winner, year),
      ...(nextGame ? [gameRepository.updateNextGameTeam(nextGame, nextGameSpot, winner, year)] : []),
      teamRepository.updateTeamRecord(winner, config.points, winArray, year),
      teamRepository.updateTeamRecord(
        loser,
        config.loserPoints,
        loseArray,
        year
      ),
    ]);
  } catch (error) {
    Logger.error("Error updating team records:", error);
    throw error;
  }
}

export { undoTeamRecords, updateTeamRecords, setRepositories };
