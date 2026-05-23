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

const router = express.Router();

// All tourney management routes are admin-only
router.post("/regionVerify", requireSiteAdmin, regionVerify);
router.post("/gamesVerify", requireSiteAdmin, gamesVerify);
router.post("/tournamentGames", requireSiteAdmin, viewTournament);
router.post("/tournamentGamesUpdate", requireSiteAdmin, tournamentUpdate);
router.post("/editTournament", requireSiteAdmin, viewTournament);
router.post("/deleteTournament", requireSiteAdmin, deleteTournamentHandler);
router.post("/setupNewTourney", requireSiteAdmin, setupNewTourney);
router.post("/createTournament", requireSiteAdmin, createTournament);
router.post("/admin/poll-espn-scheduled", requireSiteAdmin, pollEspnScheduled);

export default router;
