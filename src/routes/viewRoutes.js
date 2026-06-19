import express from "express";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  getFullGrid,
  getFullGridCSV,
  gameView,
  groupVerifyfornewEntry,
  entryVerify,
  calculateMaxPoints,
  viewEntry,
  entryUpdate,
  findEntry,
  addGroup,
  viewTeam,
  updateTeam,
  findTeam,
  addTeamPage,
  addTeam,
  addTeamApi,
  deleteTeam,
  deleteEntry,
  entryConfirm,
  myEntryLookup,
  myEntryVerify,
  myEntryView,
  myEntryUpdate,
  myBrackets,
  userEntryView,
  userEntryUpdate,
  getUnpaidEntries,
  getUnsentEmails,
  markEmailsSentController,
} from "../controllers/viewController.js";
import { getPlayground } from "../controllers/playgroundController.js";
import { requireSiteAdmin, requireUser } from "../middleware/adminMiddleware.js";
import { verifyCsrf } from "../middleware/csrf.js";

const router = express.Router();

const publicLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// Public self-service entry edit (Entry-ID + email fallback)
router.get("/my-entry", publicLimiter, myEntryLookup);
// The per-entryId brute-force guard now lives inside myEntryVerify so it counts
// only FAILED verifications — a correct email can't be locked out by an attacker
// spending the bucket on garbage attempts (#161). publicLimiter still caps
// per-IP volume here.
router.post("/my-entry/verify", publicLimiter, myEntryVerify);
router.get("/my-entry/edit", publicLimiter, myEntryView);
router.post("/my-entry/update", publicLimiter, myEntryUpdate);

// Google-authenticated "My Brackets" dashboard + edit (authorized by session email)
router.get("/my-brackets", publicLimiter, requireUser, myBrackets);
router.get("/my-brackets/edit", publicLimiter, requireUser, userEntryView);
router.post("/my-brackets/update", publicLimiter, requireUser, userEntryUpdate);

// Public routes
router.get("/playground", getPlayground);
router.post("/getFullGrid", publicLimiter, getFullGrid);
router.get("/getFullGridCSV", publicLimiter, getFullGridCSV);
router.post("/gameView", publicLimiter, gameView);
router.post("/newEntry", publicLimiter, groupVerifyfornewEntry);
router.post("/entryVerify", publicLimiter, entryVerify);
router.post("/calculateMaxPoints", publicLimiter, calculateMaxPoints);
router.get("/entryConfirm", entryConfirm);

// Admin-only routes (must be reached from the admin console)
router.get("/viewEntry", requireSiteAdmin, viewEntry);
router.post("/entryUpdate", requireSiteAdmin, verifyCsrf, entryUpdate);
router.get("/find-entry", requireSiteAdmin, findEntry);
router.get("/unpaid-entries", requireSiteAdmin, getUnpaidEntries);
router.get("/admin/unsent-emails", requireSiteAdmin, getUnsentEmails);
router.post("/admin/mark-emails-sent", requireSiteAdmin, verifyCsrf, markEmailsSentController);
router.post("/newGroup", requireSiteAdmin, verifyCsrf, addGroup);
router.get("/viewTeam", requireSiteAdmin, viewTeam);
router.post("/updateTeam", requireSiteAdmin, verifyCsrf, updateTeam);
router.get("/find-team", requireSiteAdmin, findTeam);
router.get("/addTeamPage", requireSiteAdmin, addTeamPage);
router.post("/addTeam", requireSiteAdmin, verifyCsrf, addTeam);
router.post("/api/addTeam", requireSiteAdmin, verifyCsrf, addTeamApi);
router.post("/deleteTeam", requireSiteAdmin, verifyCsrf, deleteTeam);
router.post("/deleteEntry", requireSiteAdmin, verifyCsrf, deleteEntry);

export default router;
