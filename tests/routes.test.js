import adminRoutes from '../src/routes/adminRoutes.js';
import conferenceRoutes from '../src/routes/conferenceRoutes.js';
import gameRoutes from '../src/routes/gameRoutes.js';
import indexRoutes from '../src/routes/indexRoutes.js';
import pointsRoutes from '../src/routes/pointsRoutes.js';
import tourneyRoutes from '../src/routes/tourneyRoutes.js';
import viewRoutes, { createEntryLimiter } from '../src/routes/viewRoutes.js';
import {
  requireSiteAdmin,
  requireUser,
} from '../src/middleware/adminMiddleware.js';
import { verifyCsrf } from '../src/middleware/csrf.js';

// Build a "METHOD path" → { path, method, handlers } map for one router so each
// assertion checks path + verb + middleware composition together. This catches
// real regressions (dropped auth guard, wrong verb) that a bare path check misses.
function indexRouter(router) {
  const out = {};
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const method = Object.keys(layer.route.methods)[0].toUpperCase();
    const handlers = layer.route.stack.map((l) => l.handle);
    out[`${method} ${layer.route.path}`] = {
      path: layer.route.path,
      method,
      handlers,
      handlerCount: handlers.length,
    };
  }
  return out;
}

function expectRoute(
  routes,
  key,
  {
    handlerCount,
    protectedByAdmin = false,
    protectedByUser = false,
    csrfGuarded: csrfGuardedOverride,
  },
) {
  const route = routes[key];
  expect(route, `route ${key} not registered`).toBeDefined();
  expect(
    route.handlerCount,
    `${key} should have ${handlerCount} handlers`,
  ).toBe(handlerCount);
  const guarded = route.handlers.includes(requireSiteAdmin);
  expect(
    guarded,
    `${key} guard mismatch (expected protectedByAdmin=${protectedByAdmin})`,
  ).toBe(protectedByAdmin);
  const userGuarded = route.handlers.includes(requireUser);
  expect(
    userGuarded,
    `${key} guard mismatch (expected protectedByUser=${protectedByUser})`,
  ).toBe(protectedByUser);
  // Every state-changing admin/user POST must also carry the CSRF guard, and it
  // must sit AFTER requireSiteAdmin/requireUser so unauthenticated callers still
  // get the 401 (audit finding 4 — the stored-XSS → CSRF-less deploy chain).
  // Routes authorized by a non-middleware session grant (e.g. /my-entry/update's
  // verifiedEntries check inside the controller, #301) pass csrfGuarded explicitly.
  const csrfGuarded =
    csrfGuardedOverride ??
    ((protectedByAdmin || protectedByUser) && key.startsWith('POST '));
  expect(
    route.handlers.includes(verifyCsrf),
    `${key} CSRF guard mismatch (admin POSTs must include verifyCsrf)`,
  ).toBe(csrfGuarded);
  if (csrfGuarded) {
    expect(
      route.handlers.indexOf(verifyCsrf),
      `${key}: verifyCsrf must come after requireSiteAdmin or requireUser`,
    ).toBeGreaterThan(
      Math.max(
        route.handlers.indexOf(requireSiteAdmin),
        route.handlers.indexOf(requireUser),
      ),
    );
  }
}

describe('Route registration', () => {
  describe('adminRoutes', () => {
    const r = indexRouter(adminRoutes);

    test('admin dashboard pages are GET and admin-guarded', () => {
      expectRoute(r, 'GET /admin', { handlerCount: 2, protectedByAdmin: true });
      expectRoute(r, 'GET /admin/tournament', {
        handlerCount: 2,
        protectedByAdmin: true,
      });
      expectRoute(r, 'GET /admin/entries', {
        handlerCount: 2,
        protectedByAdmin: true,
      });
      expectRoute(r, 'GET /admin/teams', {
        handlerCount: 2,
        protectedByAdmin: true,
      });
      expectRoute(r, 'GET /admin/system', {
        handlerCount: 2,
        protectedByAdmin: true,
      });
      expectRoute(r, 'GET /admin/cloud', {
        handlerCount: 2,
        protectedByAdmin: true,
      });
      expectRoute(r, 'GET /admin/cloud/budget', {
        handlerCount: 2,
        protectedByAdmin: true,
      });
    });

    test('admin logout is POST and destroys session inline (no admin guard)', () => {
      expectRoute(r, 'POST /admin/logout', {
        handlerCount: 1,
        protectedByAdmin: false,
      });
    });

    test('admin cloud deploy is POST and admin-guarded', () => {
      expectRoute(r, 'POST /admin/cloud/deploy', {
        handlerCount: 3,
        protectedByAdmin: true,
      });
    });
  });

  describe('conferenceRoutes', () => {
    const r = indexRouter(conferenceRoutes);

    test('all conference routes are admin-guarded with correct verbs', () => {
      expectRoute(r, 'GET /conferences', {
        handlerCount: 2,
        protectedByAdmin: true,
      });
      expectRoute(r, 'GET /viewConference', {
        handlerCount: 2,
        protectedByAdmin: true,
      });
      expectRoute(r, 'POST /updateConference', {
        handlerCount: 3,
        protectedByAdmin: true,
      });
      expectRoute(r, 'GET /addConferencePage', {
        handlerCount: 2,
        protectedByAdmin: true,
      });
      expectRoute(r, 'POST /addConference', {
        handlerCount: 3,
        protectedByAdmin: true,
      });
    });
  });

  describe('gameRoutes', () => {
    const r = indexRouter(gameRoutes);

    test('all game mutations are POST and admin-guarded', () => {
      expectRoute(r, 'POST /updateWinner', {
        handlerCount: 3,
        protectedByAdmin: true,
      });
      expectRoute(r, 'POST /undoGame', {
        handlerCount: 3,
        protectedByAdmin: true,
      });
      expectRoute(r, 'POST /releaseGameHold', {
        handlerCount: 3,
        protectedByAdmin: true,
      });
      expectRoute(r, 'POST /admin/trigger-espn-poll', {
        handlerCount: 3,
        protectedByAdmin: true,
      });
    });
  });

  describe('indexRoutes', () => {
    const r = indexRouter(indexRoutes);

    test('home page is public GET', () => {
      expectRoute(r, 'GET /', { handlerCount: 1, protectedByAdmin: false });
    });
  });

  describe('pointsRoutes', () => {
    const r = indexRouter(pointsRoutes);

    test('login + OAuth callback are public (callback rate-limited, not admin-guarded)', () => {
      expectRoute(r, 'GET /updates', {
        handlerCount: 1,
        protectedByAdmin: false,
      });
      expectRoute(r, 'GET /auth/google/start', {
        handlerCount: 2,
        protectedByAdmin: false,
      });
      expectRoute(r, 'GET /auth/google/user/start', {
        handlerCount: 2,
        protectedByAdmin: false,
      });
      expectRoute(r, 'GET /auth/google/callback', {
        handlerCount: 2,
        protectedByAdmin: false,
      });
    });

    test('participant logout is POST and user-guarded (never admin-guarded)', () => {
      expectRoute(r, 'POST /user/logout', {
        handlerCount: 3,
        protectedByAdmin: false,
        protectedByUser: true,
      });
    });

    test('admin mutations are POST and admin-guarded', () => {
      expectRoute(r, 'POST /updateTotalPoints', {
        handlerCount: 3,
        protectedByAdmin: true,
      });
      expectRoute(r, 'POST /possibleRank', {
        handlerCount: 3,
        protectedByAdmin: true,
      });
      expectRoute(r, 'POST /changeYear', {
        handlerCount: 3,
        protectedByAdmin: true,
      });
      expectRoute(r, 'POST /clearCache', {
        handlerCount: 3,
        protectedByAdmin: true,
      });
      expectRoute(r, 'POST /clearGoogleSessions', {
        handlerCount: 3,
        protectedByAdmin: true,
      });
    });
  });

  describe('tourneyRoutes', () => {
    const r = indexRouter(tourneyRoutes);

    test('every tournament management route is POST and admin-guarded', () => {
      const paths = [
        '/regionVerify',
        '/gamesVerify',
        '/tournamentGames',
        '/tournamentGamesUpdate',
        '/editTournament',
        '/deleteTournament',
        '/setupNewTourney',
        '/createTournament',
        '/admin/poll-espn-scheduled',
      ];
      for (const p of paths) {
        expectRoute(r, `POST ${p}`, {
          handlerCount: 3,
          protectedByAdmin: true,
        });
      }
    });
  });

  describe('viewRoutes', () => {
    const r = indexRouter(viewRoutes);

    test('self-service /my-entry routes use public rate limiter, not admin guard', () => {
      expectRoute(r, 'GET /my-entry', {
        handlerCount: 2,
        protectedByAdmin: false,
      });
      // verify's per-entryId brute-force guard moved into the controller (#161),
      // so the route is just publicLimiter + handler.
      expectRoute(r, 'POST /my-entry/verify', {
        handlerCount: 2,
        protectedByAdmin: false,
      });
      expectRoute(r, 'GET /my-entry/edit', {
        handlerCount: 2,
        protectedByAdmin: false,
      });
      // verifyCsrf added (#301): publicLimiter + verifyCsrf + handler. Not
      // requireSiteAdmin/requireUser-guarded — myEntryUpdate authorizes via the
      // verifiedEntries session grant set by /my-entry/verify.
      expectRoute(r, 'POST /my-entry/update', {
        handlerCount: 3,
        protectedByAdmin: false,
        csrfGuarded: true,
      });
    });

    test('Google-authenticated /my-brackets routes are user-guarded, not admin-guarded', () => {
      expectRoute(r, 'GET /my-brackets', {
        handlerCount: 3,
        protectedByAdmin: false,
        protectedByUser: true,
      });
      expectRoute(r, 'GET /my-brackets/edit', {
        handlerCount: 3,
        protectedByAdmin: false,
        protectedByUser: true,
      });
      expectRoute(r, 'POST /my-brackets/update', {
        handlerCount: 4,
        protectedByAdmin: false,
        protectedByUser: true,
      });
    });

    test('public read routes are not admin-guarded', () => {
      expectRoute(r, 'GET /playground', {
        handlerCount: 2,
        protectedByAdmin: false,
      });
      expectRoute(r, 'POST /getFullGrid', {
        handlerCount: 2,
        protectedByAdmin: false,
      });
      expectRoute(r, 'GET /getFullGridCSV', {
        handlerCount: 2,
        protectedByAdmin: false,
      });
      expectRoute(r, 'POST /gameView', {
        handlerCount: 2,
        protectedByAdmin: false,
      });
      expectRoute(r, 'POST /newEntry', {
        handlerCount: 3,
        protectedByAdmin: false,
      });
      expectRoute(r, 'POST /entryVerify', {
        handlerCount: 3,
        protectedByAdmin: false,
      });
      expectRoute(r, 'POST /calculateMaxPoints', {
        handlerCount: 2,
        protectedByAdmin: false,
      });
      expectRoute(r, 'GET /entryConfirm', {
        handlerCount: 1,
        protectedByAdmin: false,
      });
    });

    // A revert of createEntryLimiter back to publicLimiter (the per-instance-only
    // regression this PR fixes, #334) wouldn't change the handler count above, so
    // check the middleware by reference too.
    test('entry-creation routes use the global Firestore-backed limiter, not publicLimiter', () => {
      expectRoute(r, 'POST /newEntry', {
        handlerCount: 3,
        protectedByAdmin: false,
      });
      expectRoute(r, 'POST /entryVerify', {
        handlerCount: 3,
        protectedByAdmin: false,
      });
      expect(r['POST /newEntry'].handlers).toContain(createEntryLimiter);
      expect(r['POST /entryVerify'].handlers).toContain(createEntryLimiter);
    });

    test('admin-only view/edit routes are admin-guarded with correct verbs', () => {
      const adminGets = [
        '/viewEntry',
        '/find-entry',
        '/unpaid-entries',
        '/admin/unsent-emails',
        '/viewTeam',
        '/find-team',
        '/addTeamPage',
        '/admin/deleted-entries',
      ];
      const adminPosts = [
        '/entryUpdate',
        '/admin/mark-emails-sent',
        '/newGroup',
        '/updateTeam',
        '/addTeam',
        '/api/addTeam',
        '/deleteTeam',
        '/deleteEntry',
        '/restoreEntry',
        '/purgeEntry',
      ];

      for (const p of adminGets)
        expectRoute(r, `GET ${p}`, { handlerCount: 2, protectedByAdmin: true });
      for (const p of adminPosts)
        expectRoute(r, `POST ${p}`, {
          handlerCount: 3,
          protectedByAdmin: true,
        });
    });
  });
});
