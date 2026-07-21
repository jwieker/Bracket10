import {
  gameRepository as _gameRepository,
  teamRepository as _teamRepository,
} from '../repositories/index.js';
import { updateEntrywithNewSchools as _updateEntrywithNewSchools } from './tourneyService.js';
import { TOURNAMENT_ROUNDS } from '../config/const.js';
import Logger from '../utils/logger.js';

let teamRepository = _teamRepository;
let gameRepository = _gameRepository;
let updateEntrywithNewSchools = _updateEntrywithNewSchools;

function setRepositories(
  newTeamRepository,
  newGameRepository,
  newUpdateEntrywithNewSchools = null,
) {
  teamRepository = newTeamRepository;
  gameRepository = newGameRepository;
  if (newUpdateEntrywithNewSchools)
    updateEntrywithNewSchools = newUpdateEntrywithNewSchools;
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
  team1ID = null,
) {
  const config = TOURNAMENT_ROUNDS[round];
  if (!config) {
    throw new Error(`Invalid round number: ${round}`);
  }

  if (round === 0) {
    try {
      // Mirror of the resolution ordering: winner stays set until every
      // cleanup step has completed, so a mid-undo failure leaves the game
      // resolved (admin retries the undo; the poll skips it). The final
      // write clears the winner AND sets manualHold in one update so the
      // poll, whose ESPN feed still lists the game as completed, cannot
      // immediately re-resolve an admin's deliberate undo.
      //
      // Normalize all FF picks back to team1's sID — team1ID is always the canonical pick sID
      // for an unresolved FF game (the combined option in registration uses team1ID).
      // Build swaps: for each sID that isn't team1ID, swap it → team1ID.
      //
      // When the caller didn't supply team1ID, derive it from the game doc:
      // the blind reverse-swap fallback moves picks to the LOSER, which is
      // wrong whenever team1 was the winner being undone.
      if (!team1ID) {
        const ffGames = (await gameRepository.getFirstFourGames(year)) || [];
        const ffGame = ffGames.find((g) => Number(g.gameID) === Number(gameID));
        if (ffGame) team1ID = Number(ffGame.team1ID);
      }
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
      if (nextGame) {
        await gameRepository.updateNextGameTeam(
          nextGame,
          nextGameSpot,
          null,
          year,
        );
      }
      await gameRepository.clearWinnerWithHold(gameID, year);
      Logger.info(
        `[FF] Undone game ${gameID}: restored ${loser}, removed ${winner}, hold set`,
      );
    } catch (error) {
      Logger.error('Error undoing FF game records:', error);
      throw error;
    }
    return;
  }

  try {
    // Single transaction per game: both team-record restores, the next-round
    // slot clear, and the winner clear (with manualHold) commit or fail
    // together, so an undo racing the poll can no longer leave mixed state
    // (winner cleared but points still credited, or vice versa).
    // Round 1 restores a team to its pre-tournament state (points: null);
    // later rounds restore both teams to "won the previous round".
    const restorePoints = round === 1 ? null : config.loserPoints;
    const restoreStatus = round === 1 ? [] : Array(config.wins - 1).fill('W');
    await gameRepository.undoResolvedGame(
      {
        gameID,
        winner,
        loser,
        nextGame: nextGame || null,
        nextGameSpot,
        restorePoints,
        restoreStatus,
      },
      year,
    );
  } catch (error) {
    Logger.error('Error undoing teams records:', error);
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
  year,
) {
  const config = TOURNAMENT_ROUNDS[round];
  if (!config) {
    throw new Error(`Invalid tournament round: ${round}`);
  }

  if (round === 0) {
    try {
      // Order matters: the winner field is the commit marker. The poll only
      // retries games where winner == null, so every other step must complete
      // first — a failure before the final write leaves the game unresolved
      // and the next poll run (≤15 min) redoes all of it. Each step is
      // idempotent: the next-game slot write is an absolute transactional
      // set, the pick swap is a no-op once no entry holds the loser, and the
      // canonical-record create no-ops once the doc exists.
      if (nextGame) {
        await gameRepository.updateNextGameTeam(
          nextGame,
          nextGameSpot,
          winner,
          year,
        );
      }
      // Auto-swap all entry picks: loser → winner
      await updateEntrywithNewSchools([[winner, loser]], year);
      await teamRepository.createCanonicalSchoolRecord(winner, year);
      await gameRepository.updateWinner(gameID, winner, year);
      Logger.info(
        `[FF] Resolved game ${gameID}: winner ${winner}, loser ${loser}`,
      );
    } catch (error) {
      Logger.error('Error updating FF game records:', error);
      throw error;
    }
    return;
  }

  const winArray = Array(config.wins).fill('W');
  const loseArray = [...Array(config.wins - 1).fill('W'), 'L'];

  try {
    // Single transaction per game: winner, next-round slot, and both team
    // records commit or fail together. Previously these were four parallel
    // independent writes — a partial failure left the winner recorded but
    // points uncredited, and since resolved games drop out of the poll's
    // unresolved set, nothing ever repaired the torn state.
    await gameRepository.resolveGame(
      {
        gameID,
        winner,
        loser,
        nextGame: nextGame || null,
        nextGameSpot,
        winnerPoints: config.points,
        winnerStatus: winArray,
        loserPoints: config.loserPoints,
        loserStatus: loseArray,
      },
      year,
    );
  } catch (error) {
    Logger.error('Error updating team records:', error);
    throw error;
  }
}

export { undoTeamRecords, updateTeamRecords, setRepositories };
