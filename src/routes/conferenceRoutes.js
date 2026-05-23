import express from 'express';
import {
    listConferences,
    viewConference,
    updateConference,
    addConferencePage,
    addConference,
} from '../controllers/conferenceController.js';
import { requireSiteAdmin } from '../middleware/adminMiddleware.js';

const router = express.Router();

router.get('/conferences', requireSiteAdmin, listConferences);
router.get('/viewConference', requireSiteAdmin, viewConference);
router.post('/updateConference', requireSiteAdmin, updateConference);
router.get('/addConferencePage', requireSiteAdmin, addConferencePage);
router.post('/addConference', requireSiteAdmin, addConference);

export default router;
