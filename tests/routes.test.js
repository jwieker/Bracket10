import adminRoutes from "../src/routes/adminRoutes.js";
import conferenceRoutes from "../src/routes/conferenceRoutes.js";
import gameRoutes from "../src/routes/gameRoutes.js";
import indexRoutes from "../src/routes/indexRoutes.js";
import pointsRoutes from "../src/routes/pointsRoutes.js";
import tourneyRoutes from "../src/routes/tourneyRoutes.js";
import viewRoutes from "../src/routes/viewRoutes.js";
import { requireSiteAdmin } from "../src/middleware/adminMiddleware.js";

// Build a "METHOD path" → { path, method, handlers } map for one router so each
// assertion checks path + verb + middleware composition together. This catches
// real regressions (dropped auth guard, wrong verb) that a bare path check misses.
function indexRouter(router) {
  const out = {};
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const method = Object.keys(layer.route.methods)[0].toUpperCase();
    const handlers = layer.route.stack.map(l => l.handle);
    out[`${method} ${layer.route.path}`] = {
      path: layer.route.path,
      method,
      handlers,
      handlerCount: handlers.length,
    };
  }
  return out;
}

function expectRoute(routes, key, { handlerCount, protectedByAdmin = false }) {
  const route = routes[key];
  expect(route, `route ${key} not registered`).toBeDefined();
  expect(route.handlerCount, `${key} should have ${handlerCount} handlers`).toBe(handlerCount);
  const guarded = route.handlers.includes(requireSiteAdmin);
  expect(guarded, `${key} guard mismatch (expected protectedByAdmin=${protectedByAdmin})`).toBe(protectedByAdmin);
}

describe("Route registration", () => {
  describe("adminRoutes", () => {
    const r = indexRouter(adminRoutes);

    test("admin dashboard pages are GET and admin-guarded", () => {
      expectRoute(r, "GET /admin",                  { handlerCount: 2, protectedByAdmin: true });
      expectRoute(r, "GET /admin/tournament",       { handlerCount: 2, protectedByAdmin: true });
      expectRoute(r, "GET /admin/entries",          { handlerCount: 2, protectedByAdmin: true });
      expectRoute(r, "GET /admin/teams",            { handlerCount: 2, protectedByAdmin: true });
      expectRoute(r, "GET /admin/system",           { handlerCount: 2, protectedByAdmin: true });
      expectRoute(r, "GET /admin/cloud",            { handlerCount: 2, protectedByAdmin: true });
      expectRoute(r, "GET /admin/cloud/budget",     { handlerCount: 2, protectedByAdmin: true });
    });

    test("admin logout is POST and destroys session inline (no admin guard)", () => {
      expectRoute(r, "POST /admin/logout", { handlerCount: 1, protectedByAdmin: false });
    });

    test("admin cloud deploy is POST and admin-guarded", () => {
      expectRoute(r, "POST /admin/cloud/deploy", { handlerCount: 2, protectedByAdmin: true });
    });
  });

  describe("conferenceRoutes", () => {
    const r = indexRouter(conferenceRoutes);

    test("all conference routes are admin-guarded with correct verbs", () => {
      expectRoute(r, "GET /conferences",       { handlerCount: 2, protectedByAdmin: true });
      expectRoute(r, "GET /viewConference",    { handlerCount: 2, protectedByAdmin: true });
      expectRoute(r, "POST /updateConference", { handlerCount: 2, protectedByAdmin: true });
      expectRoute(r, "GET /addConferencePage", { handlerCount: 2, protectedByAdmin: true });
      expectRoute(r, "POST /addConference",    { handlerCount: 2, protectedByAdmin: true });
    });
  });

  describe("gameRoutes", () => {
    const r = indexRouter(gameRoutes);

    test("all game mutations are POST and admin-guarded", () => {
      expectRoute(r, "POST /updateWinner",            { handlerCount: 2, protectedByAdmin: true });
      expectRoute(r, "POST /undoGame",                { handlerCount: 2, protectedByAdmin: true });
      expectRoute(r, "POST /admin/trigger-espn-poll", { handlerCount: 2, protectedByAdmin: true });
    });
  });

  describe("indexRoutes", () => {
    const r = indexRouter(indexRoutes);

    test("home page is public GET", () => {
      expectRoute(r, "GET /", { handlerCount: 1, protectedByAdmin: false });
    });
  });

  describe("pointsRoutes", () => {
    const r = indexRouter(pointsRoutes);

    test("login + OAuth callback are public (callback rate-limited, not admin-guarded)", () => {
      expectRoute(r, "GET /updates",              { handlerCount: 1, protectedByAdmin: false });
      expectRoute(r, "GET /auth/google/start",    { handlerCount: 2, protectedByAdmin: false });
      expectRoute(r, "GET /auth/google/callback", { handlerCount: 2, protectedByAdmin: false });
    });

    test("admin mutations are POST and admin-guarded", () => {
      expectRoute(r, "POST /updateTotalPoints", { handlerCount: 2, protectedByAdmin: true });
      expectRoute(r, "POST /possibleRank",      { handlerCount: 2, protectedByAdmin: true });
      expectRoute(r, "POST /changeYear",        { handlerCount: 2, protectedByAdmin: true });
      expectRoute(r, "POST /clearCache",        { handlerCount: 2, protectedByAdmin: true });
    });
  });

  describe("tourneyRoutes", () => {
    const r = indexRouter(tourneyRoutes);

    test("every tournament management route is POST and admin-guarded", () => {
      const paths = [
        "/regionVerify", "/gamesVerify", "/tournamentGames", "/tournamentGamesUpdate",
        "/editTournament", "/deleteTournament", "/setupNewTourney",
        "/createTournament", "/admin/poll-espn-scheduled",
      ];
      for (const p of paths) {
        expectRoute(r, `POST ${p}`, { handlerCount: 2, protectedByAdmin: true });
      }
    });
  });

  describe("viewRoutes", () => {
    const r = indexRouter(viewRoutes);

    test("self-service /my-entry routes use public rate limiter, not admin guard", () => {
      expectRoute(r, "GET /my-entry",         { handlerCount: 2, protectedByAdmin: false });
      expectRoute(r, "POST /my-entry/verify", { handlerCount: 2, protectedByAdmin: false });
      expectRoute(r, "GET /my-entry/edit",    { handlerCount: 2, protectedByAdmin: false });
      expectRoute(r, "POST /my-entry/update", { handlerCount: 2, protectedByAdmin: false });
    });

    test("public read routes are not admin-guarded", () => {
      expectRoute(r, "GET /playground",          { handlerCount: 1, protectedByAdmin: false });
      expectRoute(r, "POST /getFullGrid",        { handlerCount: 2, protectedByAdmin: false });
      expectRoute(r, "GET /getFullGridCSV",      { handlerCount: 2, protectedByAdmin: false });
      expectRoute(r, "POST /gameView",           { handlerCount: 2, protectedByAdmin: false });
      expectRoute(r, "POST /newEntry",           { handlerCount: 2, protectedByAdmin: false });
      expectRoute(r, "POST /entryVerify",        { handlerCount: 2, protectedByAdmin: false });
      expectRoute(r, "POST /calculateMaxPoints", { handlerCount: 2, protectedByAdmin: false });
      expectRoute(r, "GET /entryConfirm",        { handlerCount: 1, protectedByAdmin: false });
    });

    test("admin-only view/edit routes are admin-guarded with correct verbs", () => {
      const adminGets  = ["/viewEntry", "/find-entry", "/unpaid-entries",
                          "/admin/unsent-emails", "/viewTeam", "/find-team", "/addTeamPage"];
      const adminPosts = ["/entryUpdate", "/admin/mark-emails-sent", "/newGroup",
                          "/updateTeam", "/addTeam", "/api/addTeam",
                          "/deleteTeam", "/deleteEntry"];

      for (const p of adminGets)  expectRoute(r, `GET ${p}`,  { handlerCount: 2, protectedByAdmin: true });
      for (const p of adminPosts) expectRoute(r, `POST ${p}`, { handlerCount: 2, protectedByAdmin: true });
    });
  });
});
