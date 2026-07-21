import express from 'express';
import { firestoreRateLimit, normalizeIP } from '../middleware/rateLimit.js';
import {
  updateTotalPoints,
  getPossibleRanking,
  adminLogin,
  startGoogleAuth,
  startUserGoogleAuth,
  googleAuthCallback,
  userLogout,
  clearCacheHandler,
  clearGoogleSessionsHandler,
} from '../controllers/pointsController.js';
import { changeYear } from '../controllers/adminController.js';
import {
  requireSiteAdmin,
  requireUser,
} from '../middleware/adminMiddleware.js';
import { verifyCsrf } from '../middleware/csrf.js';

const router = express.Router();

// Firestore-backed so the 15/10min cap is global across Cloud Run instances,
// not per-process (M1). Keyed by client IP, bucketed to the IPv6 /64 prefix so
// an attacker can't mint unlimited fresh buckets by rotating within one subnet.
const loginLimiter = firestoreRateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 15,
  keyGenerator: (req) => `login:${normalizeIP(req.ip) || 'unknown'}`,
  message: 'Too many login attempts. Please try again in 10 minutes.',
});

// Entry point — login page and Google OAuth redirect callback
router.get('/updates', adminLogin);
router.get('/auth/google/start', loginLimiter, startGoogleAuth);
// Participant ("My Brackets") Google sign-in — shares the callback below.
router.get('/auth/google/user/start', loginLimiter, startUserGoogleAuth);
router.get('/auth/google/callback', loginLimiter, googleAuthCallback);
router.post('/user/logout', requireUser, verifyCsrf, userLogout);

// Admin-only actions (must come from within the admin console)
router.post(
  '/updateTotalPoints',
  requireSiteAdmin,
  verifyCsrf,
  updateTotalPoints,
);
router.post('/possibleRank', requireSiteAdmin, verifyCsrf, getPossibleRanking);
router.post('/changeYear', requireSiteAdmin, verifyCsrf, changeYear);
router.post('/clearCache', requireSiteAdmin, verifyCsrf, clearCacheHandler);
router.post(
  '/clearGoogleSessions',
  requireSiteAdmin,
  verifyCsrf,
  clearGoogleSessionsHandler,
);

export default router;
