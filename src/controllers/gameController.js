import {
  updateTeamRecords,
  undoTeamRecords,
  runEspnPoll,
  updatePointsForAffectedEntries,
} from '../services/index.js';
import {
  controllerWrapper,
  parseYear,
  parsePositiveInt,
} from '../utils/controllerUtils.js';
import { APP_CONFIG } from '../config/app.js';
import { TOURNAMENT_ROUNDS } from '../config/const.js';
import { gameRepository } from '../repositories/index.js';
import { ValidationError } from '../utils/errors.js';

// Shared payload validation for updateWinner/undoGame — the admin's manual
// result-entry endpoints, the most consequential writes in the system (#425).
// Every field is validated before any service call: previously a missing
// winnerID became NaN and was written into the game doc and next-round slot
// (where the poll could never repair it), and a winnerID matching neither
// team silently recorded team1 as the loser and recomputed points for the
// wrong team set. The services themselves are unchanged — the poll pipeline
// reaches them with internally derived values and must not change behavior.
function parseGameResultPayload(body) {
  const gameID = parsePositiveInt(body['gameID'], 'gameID');
  const team1ID = parsePositiveInt(body['team1ID'], 'team1ID');
  const team2ID = parsePositiveInt(body['team2ID'], 'team2ID');
  const winner = parsePositiveInt(body['winnerID'], 'winnerID');
  const year = parseYear(body['year']);

  // Round 0 (First Four) is valid — parsePositiveInt would reject it, so
  // validate against the round table the services resolve points from.
  const round = Number(body['round']);
  if (!Number.isInteger(round) || TOURNAMENT_ROUNDS[round] === undefined) {
    throw new ValidationError(
      `round must be a tournament round 0-6 (got: ${body['round']})`,
      'round',
    );
  }

  if (team1ID === team2ID) {
    throw new ValidationError('team1ID and team2ID must differ', 'team2ID');
  }
  if (winner !== team1ID && winner !== team2ID) {
    throw new ValidationError(
      `winnerID (${winner}) must match team1ID (${team1ID}) or team2ID (${team2ID})`,
      'winnerID',
    );
  }
  const loser = winner === team1ID ? team2ID : team1ID;

  // The championship game has no next game — game docs carry nextGameID 0 or
  // null there, so the admin client submits '' or '0'. Normalize that to
  // null, matching the `nextGame || null` contract the services already
  // apply. When a next game IS set, its spot must be exactly 1 or 2: the
  // repository picks the slot with `nextGameSpot === 1 ? 'team1' : 'team2'`,
  // so any other value would silently land the winner in team2's slot.
  const rawNextGame = body['nextGameID'];
  let nextGame = null;
  let nextGameSpot = null;
  if (
    rawNextGame !== undefined &&
    rawNextGame !== null &&
    rawNextGame !== '' &&
    Number(rawNextGame) !== 0
  ) {
    nextGame = parsePositiveInt(rawNextGame, 'nextGameID');
    nextGameSpot = Number(body['nextGameSpot']);
    if (nextGameSpot !== 1 && nextGameSpot !== 2) {
      throw new ValidationError(
        'nextGameSpot must be 1 or 2 when nextGameID is set',
        'nextGameSpot',
      );
    }
  }

  return {
    gameID,
    winner,
    loser,
    nextGame,
    nextGameSpot,
    round,
    team1ID,
    team2ID,
    year,
  };
}

const updateWinner = controllerWrapper(async (req, res) => {
  const { gameID, winner, loser, nextGame, nextGameSpot, round, year } =
    parseGameResultPayload(req.body);

  await updateTeamRecords(
    winner,
    loser,
    round,
    gameID,
    nextGame,
    nextGameSpot,
    year,
  );
  // Recompute points for just the entries holding either team — the same
  // targeted path the ESPN poll uses. A single manual result must not pay a
  // full year-wide read+write of every entry (#369); POST /updateTotalPoints
  // remains the explicit full-repair action. Awaited (not fire-and-forget) so
  // a recalc failure surfaces as a 500 instead of "updated successfully"
  // while standings are silently stale (#259).
  await updatePointsForAffectedEntries(year, [winner, loser]);
  res.status(200).json({ message: 'Game result updated successfully' });
}, 'updateWinner');

const undoGame = controllerWrapper(async (req, res) => {
  const {
    gameID,
    winner,
    loser,
    nextGame,
    nextGameSpot,
    round,
    team1ID,
    year,
  } = parseGameResultPayload(req.body);

  await undoTeamRecords(
    winner,
    loser,
    round,
    gameID,
    nextGame,
    nextGameSpot,
    year,
    team1ID,
  );
  // Targeted recompute for the two affected teams — see updateWinner above.
  // For a round-0 undo the picks were just swapped back toward team1, which
  // is always one of [winner, loser], so the same pair covers that path too.
  await updatePointsForAffectedEntries(year, [winner, loser]);
  res.status(200).json({ message: 'Game result updated successfully' });
}, 'undoGame');

const triggerEspnPoll = controllerWrapper(async (req, res) => {
  const year = APP_CONFIG.tournament.currentYear;
  const dateStr = req.body?.dateStr || null;
  const result = await runEspnPoll(year, { dryRun: true, dateStr });
  res.status(200).json(result);
}, 'triggerEspnPoll');

/**
 * Releases the manualHold set by an undo, letting the ESPN poll resolve the
 * game again. Undo + release-hold is the "let ESPN re-apply it" path; undo
 * alone keeps the game frozen for manual handling.
 */
const releaseGameHold = controllerWrapper(async (req, res) => {
  const gameID = Number(req.body['gameID']);
  const year = parseYear(req.body['year']);
  if (!Number.isInteger(gameID) || gameID <= 0) {
    throw new ValidationError('A valid gameID is required.', 'gameID');
  }
  await gameRepository.setGameManualHold(gameID, false, year);
  res
    .status(200)
    .json({ message: 'Hold released — the poll can resolve this game again' });
}, 'releaseGameHold');

export { updateWinner, undoGame, triggerEspnPoll, releaseGameHold };
