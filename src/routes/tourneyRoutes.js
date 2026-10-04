import express from 'express';
import {
  regionVerify,
  gamesVerify,
  viewTournament,
  tournamentUpdate,
  deleteTournamentHandler,
  setupNewTourney,
  createTournament,
  pollEspnScheduled,
  espnTournamentSetupPage,
  previewEspnTournamentPlan,
  createTournamentFromEspn,
} from '../controllers/tourneyController.js';
import { requireSiteAdmin } from '../middleware/adminMiddleware.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = express.Router();

// Per-process, per-IP throttle — mounted after the admin/CSRF checks per the
// plan, since neither of those alone bounds how many ESPN fetches + Firestore
// reference reads one admin session can trigger; no existing tournament-wide
// limiter covers these routes.
const espnPlanLimiter = rateLimit({
  windowMs: 60000,
  max: 30,
  standardHeaders: true,
});

// All tourney management routes are admin-only
router.post('/regionVerify', requireSiteAdmin, verifyCsrf, regionVerify);
router.post('/gamesVerify', requireSiteAdmin, verifyCsrf, gamesVerify);
router.post('/tournamentGames', requireSiteAdmin, verifyCsrf, viewTournament);
router.post(
  '/tournamentGamesUpdate',
  requireSiteAdmin,
  verifyCsrf,
  tournamentUpdate,
);
router.post('/editTournament', requireSiteAdmin, verifyCsrf, viewTournament);
router.post(
  '/deleteTournament',
  requireSiteAdmin,
  verifyCsrf,
  deleteTournamentHandler,
);
router.post('/setupNewTourney', requireSiteAdmin, verifyCsrf, setupNewTourney);
router.post(
  '/createTournament',
  requireSiteAdmin,
  verifyCsrf,
  createTournament,
);
router.post(
  '/admin/poll-espn-scheduled',
  requireSiteAdmin,
  verifyCsrf,
  pollEspnScheduled,
);

router.get(
  '/admin/tournament/espn-setup',
  requireSiteAdmin,
  espnTournamentSetupPage,
);
router.post(
  '/admin/tournament/espn-plan',
  requireSiteAdmin,
  verifyCsrf,
  espnPlanLimiter,
  previewEspnTournamentPlan,
);
router.post(
  '/createTournamentFromEspn',
  requireSiteAdmin,
  verifyCsrf,
  espnPlanLimiter,
  createTournamentFromEspn,
);

export default router;
