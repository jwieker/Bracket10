import express from 'express';
import {
  updateWinner,
  undoGame,
  triggerEspnPoll,
  releaseGameHold,
} from '../controllers/gameController.js';
import { requireSiteAdmin } from '../middleware/adminMiddleware.js';
import { verifyCsrf } from '../middleware/csrf.js';

const router = express.Router();

router.post('/updateWinner', requireSiteAdmin, verifyCsrf, updateWinner);
router.post('/undoGame', requireSiteAdmin, verifyCsrf, undoGame);
router.post('/releaseGameHold', requireSiteAdmin, verifyCsrf, releaseGameHold);
router.post(
  '/admin/trigger-espn-poll',
  requireSiteAdmin,
  verifyCsrf,
  triggerEspnPoll,
);

export default router;
