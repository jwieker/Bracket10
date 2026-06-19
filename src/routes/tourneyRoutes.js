import express from "express";
import {
  regionVerify,
  gamesVerify,
  viewTournament,
  tournamentUpdate,
  deleteTournamentHandler,
  setupNewTourney,
  createTournament,
  pollEspnScheduled,
} from "../controllers/tourneyController.js";
import { requireSiteAdmin } from "../middleware/adminMiddleware.js";
import { verifyCsrf } from "../middleware/csrf.js";

const router = express.Router();

// All tourney management routes are admin-only
router.post("/regionVerify", requireSiteAdmin, verifyCsrf, regionVerify);
router.post("/gamesVerify", requireSiteAdmin, verifyCsrf, gamesVerify);
router.post("/tournamentGames", requireSiteAdmin, verifyCsrf, viewTournament);
router.post("/tournamentGamesUpdate", requireSiteAdmin, verifyCsrf, tournamentUpdate);
router.post("/editTournament", requireSiteAdmin, verifyCsrf, viewTournament);
router.post("/deleteTournament", requireSiteAdmin, verifyCsrf, deleteTournamentHandler);
router.post("/setupNewTourney", requireSiteAdmin, verifyCsrf, setupNewTourney);
router.post("/createTournament", requireSiteAdmin, verifyCsrf, createTournament);
router.post("/admin/poll-espn-scheduled", requireSiteAdmin, verifyCsrf, pollEspnScheduled);

export default router;
