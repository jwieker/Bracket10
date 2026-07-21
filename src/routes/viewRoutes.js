import express from 'express';
import {
  rateLimit,
  firestoreRateLimit,
  normalizeIP,
} from '../middleware/rateLimit.js';
import {
  getFullGrid,
  getFullGridCSV,
  gameView,
  calculateMaxPoints,
} from '../controllers/resultsController.js';
import {
  groupVerifyfornewEntry,
  entryVerify,
  entryConfirm,
} from '../controllers/registrationController.js';
import {
  viewEntry,
  entryUpdate,
  findEntry,
  addGroup,
  deleteEntry,
  restoreEntry,
  purgeEntry,
  getDeletedEntriesController,
  getUnpaidEntries,
  getUnsentEmails,
  markEmailsSentController,
} from '../controllers/adminEntryController.js';
import {
  viewTeam,
  updateTeam,
  findTeam,
  addTeamPage,
  addTeam,
  addTeamApi,
  deleteTeam,
} from '../controllers/teamController.js';
import {
  myEntryLookup,
  myEntryVerify,
  myEntryView,
  myEntryUpdate,
  myBrackets,
  userEntryView,
  userEntryUpdate,
} from '../controllers/selfServiceController.js';
import { getPlayground } from '../controllers/playgroundController.js';
import {
  requireSiteAdmin,
  requireUser,
} from '../middleware/adminMiddleware.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { isRegistrationOpen } from '../config/app.js';

const router = express.Router();

const publicLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// publicLimiter's `clients` Map is per-process, so each Cloud Run instance
// keeps its own 30/min bucket — an attacker spread across instances multiplies
// the effective cap. Entry creation writes to Firestore and is otherwise
// unauthenticated, so it gets the Firestore-backed limiter instead, which
// shares one counter across every instance (#334).
const createEntryLimiter = firestoreRateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  keyGenerator: (req) => `createEntry:${normalizeIP(req.ip) || 'unknown'}`,
  message: 'Too many entry submissions. Please try again in a minute.',
});

// createEntryLimiter is a Firestore transaction; check the cheap synchronous
// window condition first so the ~361 days/year registration is closed, a POST
// here 403s without touching Firestore (#334 pr-debate round 1).
const requireRegistrationOpen = (req, res, next) => {
  if (!isRegistrationOpen()) return res.status(403).render('myEntryClosed');
  next();
};

// Public self-service entry edit (Entry-ID + email fallback)
router.get('/my-entry', publicLimiter, myEntryLookup);
// The per-entryId brute-force guard now lives inside myEntryVerify so it counts
// only FAILED verifications — a correct email can't be locked out by an attacker
// spending the bucket on garbage attempts (#161). publicLimiter still caps
// per-IP volume here.
router.post('/my-entry/verify', publicLimiter, myEntryVerify);
router.get('/my-entry/edit', publicLimiter, myEntryView);
// verifyCsrf here (#301): entryId/year are visible in the /my-entry/edit URL,
// so without a token check this was forgeable via a cross-site top-level
// form POST against any session still holding a verifiedEntries grant.
router.post('/my-entry/update', publicLimiter, verifyCsrf, myEntryUpdate);

// Google-authenticated "My Brackets" dashboard + edit (authorized by session email)
router.get('/my-brackets', publicLimiter, requireUser, myBrackets);
router.get('/my-brackets/edit', publicLimiter, requireUser, userEntryView);
router.post(
  '/my-brackets/update',
  publicLimiter,
  requireUser,
  verifyCsrf,
  userEntryUpdate,
);

// Public routes
// buildPlaygroundData has no service-level result cache (unlike buildGameViewData),
// so an uncapped GET here re-runs the full O(entries x teams) grid compute on every
// hit — publicLimiter caps that the same way it already caps POST /getFullGrid,
// the other public entry point into the same compute (#393).
router.get('/playground', publicLimiter, getPlayground);
router.post('/getFullGrid', publicLimiter, getFullGrid);
router.get('/getFullGridCSV', publicLimiter, getFullGridCSV);
router.post('/gameView', publicLimiter, gameView);
router.post(
  '/newEntry',
  requireRegistrationOpen,
  createEntryLimiter,
  groupVerifyfornewEntry,
);
router.post(
  '/entryVerify',
  requireRegistrationOpen,
  createEntryLimiter,
  entryVerify,
);
router.post('/calculateMaxPoints', publicLimiter, calculateMaxPoints);
router.get('/entryConfirm', entryConfirm);

// Admin-only routes (must be reached from the admin console)
router.get('/viewEntry', requireSiteAdmin, viewEntry);
router.post('/entryUpdate', requireSiteAdmin, verifyCsrf, entryUpdate);
router.get('/find-entry', requireSiteAdmin, findEntry);
router.get('/unpaid-entries', requireSiteAdmin, getUnpaidEntries);
router.get('/admin/unsent-emails', requireSiteAdmin, getUnsentEmails);
router.post(
  '/admin/mark-emails-sent',
  requireSiteAdmin,
  verifyCsrf,
  markEmailsSentController,
);
router.post('/newGroup', requireSiteAdmin, verifyCsrf, addGroup);
router.get('/viewTeam', requireSiteAdmin, viewTeam);
router.post('/updateTeam', requireSiteAdmin, verifyCsrf, updateTeam);
router.get('/find-team', requireSiteAdmin, findTeam);
router.get('/addTeamPage', requireSiteAdmin, addTeamPage);
router.post('/addTeam', requireSiteAdmin, verifyCsrf, addTeam);
router.post('/api/addTeam', requireSiteAdmin, verifyCsrf, addTeamApi);
router.post('/deleteTeam', requireSiteAdmin, verifyCsrf, deleteTeam);
router.post('/deleteEntry', requireSiteAdmin, verifyCsrf, deleteEntry);
router.post('/restoreEntry', requireSiteAdmin, verifyCsrf, restoreEntry);
router.post('/purgeEntry', requireSiteAdmin, verifyCsrf, purgeEntry);
router.get(
  '/admin/deleted-entries',
  requireSiteAdmin,
  getDeletedEntriesController,
);

export { createEntryLimiter };
export default router;
