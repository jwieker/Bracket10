import express from 'express';
import {
  adminDashboard,
  adminTournamentPage,
  adminEntriesPage,
  adminTeamsPage,
  adminSystemPage,
  adminCloudPage,
  adminCloudBudgetRefresh,
  adminCloudDeploy,
} from '../controllers/adminController.js';
import { requireSiteAdmin } from '../middleware/adminMiddleware.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { saveSession, destroySession } from '../utils/controllerUtils.js';
import Logger from '../utils/logger.js';

const router = express.Router();

router.get('/admin', requireSiteAdmin, adminDashboard);
router.get('/admin/tournament', requireSiteAdmin, adminTournamentPage);
router.get('/admin/entries', requireSiteAdmin, adminEntriesPage);
router.get('/admin/teams', requireSiteAdmin, adminTeamsPage);
router.get('/admin/system', requireSiteAdmin, adminSystemPage);
router.get('/admin/cloud', requireSiteAdmin, adminCloudPage);
router.get('/admin/cloud/budget', requireSiteAdmin, adminCloudBudgetRefresh);
router.post(
  '/admin/cloud/deploy',
  requireSiteAdmin,
  verifyCsrf,
  adminCloudDeploy,
);

router.post('/admin/logout', async (req, res) => {
  delete req.session.siteAdmin;
  delete req.session.adminEmail;
  delete req.session.csrfToken;
  try {
    if (req.session.userEmail) {
      await saveSession(req);
    } else {
      await destroySession(req);
    }
  } catch (error) {
    // Same rationale as pointsController's userLogout (#368): don't redirect as
    // "logged out" if the store write that would actually clear siteAdmin failed.
    Logger.error('[admin/logout] session save/destroy failed:', error);
    return res.status(500).send('Logout failed');
  }
  return res.redirect('/updates');
});

export default router;
