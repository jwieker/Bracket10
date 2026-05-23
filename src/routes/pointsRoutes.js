import express from "express";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  updateTotalPoints,
  getPossibleRanking,
  adminLogin,
  startGoogleAuth,
  googleAuthCallback,
  clearCacheHandler,
} from "../controllers/pointsController.js";
import { changeYear } from "../controllers/adminController.js";
import { requireSiteAdmin } from "../middleware/adminMiddleware.js";

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Please try again in 10 minutes.',
});

// Entry point — login page and Google OAuth redirect callback
router.get("/updates", adminLogin);
router.get("/auth/google/start", loginLimiter, startGoogleAuth);
router.get("/auth/google/callback", loginLimiter, googleAuthCallback);

// Admin-only actions (must come from within the admin console)
router.post("/updateTotalPoints", requireSiteAdmin, updateTotalPoints);
router.post("/possibleRank", requireSiteAdmin, getPossibleRanking);
router.post("/changeYear", requireSiteAdmin, changeYear);
router.post("/clearCache", requireSiteAdmin, clearCacheHandler);

export default router;
