import express from "express";
import { updateWinner, undoGame, triggerEspnPoll } from "../controllers/gameController.js";
import { requireSiteAdmin } from "../middleware/adminMiddleware.js";

const router = express.Router();

router.post("/updateWinner", requireSiteAdmin, updateWinner);
router.post("/undoGame", requireSiteAdmin, undoGame);
router.post("/admin/trigger-espn-poll", requireSiteAdmin, triggerEspnPoll);

export default router;
