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
  getUnpaidEntries,
  getUnsentEmails,
  markEmailsSentController,
} from "../controllers/viewController.js";
import { getPlayground } from "../controllers/playgroundController.js";
import { requireSiteAdmin } from "../middleware/adminMiddleware.js";

const router = express.Router();

const publicLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// Public self-service entry edit
router.get("/my-entry", publicLimiter, myEntryLookup);
router.post("/my-entry/verify", publicLimiter, myEntryVerify);
router.get("/my-entry/edit", publicLimiter, myEntryView);
router.post("/my-entry/update", publicLimiter, myEntryUpdate);

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
router.post("/entryUpdate", requireSiteAdmin, entryUpdate);
router.get("/find-entry", requireSiteAdmin, findEntry);
router.get("/unpaid-entries", requireSiteAdmin, getUnpaidEntries);
router.get("/admin/unsent-emails", requireSiteAdmin, getUnsentEmails);
router.post("/admin/mark-emails-sent", requireSiteAdmin, markEmailsSentController);
router.post("/newGroup", requireSiteAdmin, addGroup);
router.get("/viewTeam", requireSiteAdmin, viewTeam);
router.post("/updateTeam", requireSiteAdmin, updateTeam);
router.get("/find-team", requireSiteAdmin, findTeam);
router.get("/addTeamPage", requireSiteAdmin, addTeamPage);
router.post("/addTeam", requireSiteAdmin, addTeam);
router.post("/api/addTeam", requireSiteAdmin, addTeamApi);
router.post("/deleteTeam", requireSiteAdmin, deleteTeam);
router.post("/deleteEntry", requireSiteAdmin, deleteEntry);

export default router;
