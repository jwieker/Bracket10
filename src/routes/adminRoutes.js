import express from "express";
import {
  adminDashboard,
  adminTournamentPage,
  adminEntriesPage,
  adminTeamsPage,
  adminSystemPage,
  adminCloudPage,
  adminCloudBudgetRefresh,
  adminCloudDeploy,
} from "../controllers/adminController.js";
import { requireSiteAdmin } from "../middleware/adminMiddleware.js";
import { verifyCsrf } from "../middleware/csrf.js";

const router = express.Router();

router.get("/admin", requireSiteAdmin, adminDashboard);
router.get("/admin/tournament", requireSiteAdmin, adminTournamentPage);
router.get("/admin/entries", requireSiteAdmin, adminEntriesPage);
router.get("/admin/teams", requireSiteAdmin, adminTeamsPage);
router.get("/admin/system", requireSiteAdmin, adminSystemPage);
router.get("/admin/cloud", requireSiteAdmin, adminCloudPage);
router.get("/admin/cloud/budget", requireSiteAdmin, adminCloudBudgetRefresh);
router.post("/admin/cloud/deploy", requireSiteAdmin, verifyCsrf, adminCloudDeploy);

router.post("/admin/logout", (req, res) => {
  delete req.session.siteAdmin;
  delete req.session.adminEmail;
  delete req.session.csrfToken;
  if (req.session.userEmail) {
    req.session.save(() => res.redirect("/updates"));
  } else {
    req.session.destroy(() => res.redirect("/updates"));
  }
});

export default router;
