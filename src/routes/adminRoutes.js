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

const router = express.Router();

router.get("/admin", requireSiteAdmin, adminDashboard);
router.get("/admin/tournament", requireSiteAdmin, adminTournamentPage);
router.get("/admin/entries", requireSiteAdmin, adminEntriesPage);
router.get("/admin/teams", requireSiteAdmin, adminTeamsPage);
router.get("/admin/system", requireSiteAdmin, adminSystemPage);
router.get("/admin/cloud", requireSiteAdmin, adminCloudPage);
router.get("/admin/cloud/budget", requireSiteAdmin, adminCloudBudgetRefresh);
router.post("/admin/cloud/deploy", requireSiteAdmin, adminCloudDeploy);

router.post("/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/updates");
  });
});

export default router;
