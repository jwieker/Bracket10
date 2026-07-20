import express from 'express';
import {
  listConferences,
  viewConference,
  updateConference,
  addConferencePage,
  addConference,
} from '../controllers/conferenceController.js';
import { requireSiteAdmin } from '../middleware/adminMiddleware.js';
import { verifyCsrf } from '../middleware/csrf.js';

const router = express.Router();

router.get('/conferences', requireSiteAdmin, listConferences);
router.get('/viewConference', requireSiteAdmin, viewConference);
router.post(
  '/updateConference',
  requireSiteAdmin,
  verifyCsrf,
  updateConference,
);
router.get('/addConferencePage', requireSiteAdmin, addConferencePage);
router.post('/addConference', requireSiteAdmin, verifyCsrf, addConference);

export default router;
