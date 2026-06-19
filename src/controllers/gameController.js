import { updateTeamRecords, undoTeamRecords, runEspnPoll } from "../services/index.js";
import { updateTotalPointsJustYear } from "./pointsController.js";
import { controllerWrapper, parseYear } from "../utils/controllerUtils.js";
import { APP_CONFIG } from "../config/app.js";
import { gameRepository } from "../repositories/index.js";
import { ValidationError } from "../utils/errors.js";
const updateWinner = controllerWrapper(async (req, res) => {
  const gameID = Number(req.body["gameID"]);
  const winner = Number(req.body["winnerID"]);
  const nextGame = Number(req.body["nextGameID"]);
  const nextGameSpot = Number(req.body["nextGameSpot"]);
  const round = Number(req.body["round"]);
  const team1ID = Number(req.body["team1ID"]);
  const team2ID = Number(req.body["team2ID"]);
  const year = parseYear(req.body["year"]);
  let loser = team1ID;
  if (winner == team1ID) {
    loser = team2ID;
  }

  await updateTeamRecords(
    winner,
    loser,
    round,
    gameID,
    nextGame,
    nextGameSpot,
    year
  );
  // Call updateTotalPoints after game record update
  await updateTotalPointsJustYear(Number(year));
  res.status(200).json({ message: "Game result updated successfully" });
}, "updateWinner");

const undoGame = controllerWrapper(async (req, res) => {
  const gameID = Number(req.body["gameID"]);
  const winner = Number(req.body["winnerID"]);
  const nextGame = Number(req.body["nextGameID"]);
  const nextGameSpot = Number(req.body["nextGameSpot"]);
  const round = Number(req.body["round"]);
  const team1ID = Number(req.body["team1ID"]);
  const team2ID = Number(req.body["team2ID"]);
  const year = parseYear(req.body["year"]);
  let loser = team1ID;
  if (winner == team1ID) {
    loser = team2ID;
  }

  await undoTeamRecords(
    winner,
    loser,
    round,
    gameID,
    nextGame,
    nextGameSpot,
    year,
    team1ID
  );
  // Call updateTotalPoints after game record undo
  await updateTotalPointsJustYear(Number(year));
  res.status(200).json({ message: "Game result updated successfully" });
}, "undoGame");

const triggerEspnPoll = controllerWrapper(async (req, res) => {
  const year = APP_CONFIG.tournament.currentYear;
  const dateStr = req.body?.dateStr || null;
  const result = await runEspnPoll(year, { dryRun: true, dateStr });
  res.status(200).json(result);
}, "triggerEspnPoll");

/**
 * Releases the manualHold set by an undo, letting the ESPN poll resolve the
 * game again. Undo + release-hold is the "let ESPN re-apply it" path; undo
 * alone keeps the game frozen for manual handling.
 */
const releaseGameHold = controllerWrapper(async (req, res) => {
  const gameID = Number(req.body["gameID"]);
  const year = parseYear(req.body["year"]);
  if (!Number.isInteger(gameID) || gameID <= 0) {
    throw new ValidationError("A valid gameID is required.", "gameID");
  }
  await gameRepository.setGameManualHold(gameID, false, year);
  res.status(200).json({ message: "Hold released — the poll can resolve this game again" });
}, "releaseGameHold");

export {
  updateWinner,
  undoGame,
  triggerEspnPoll,
  releaseGameHold,
};
