// #311 (QA-2) — end-to-end coverage of the admin mutation routes through their
// REAL middleware stack. tests/routes.test.js verifies route *registration*
// (path, verb, guard composition via static stack inspection) but never
// executes a handler; these tests actually drive the state-changing routes
// over HTTP, so a dropped `requireSiteAdmin` or `verifyCsrf` fails CI instead
// of being discovered the night of the tournament.
//
// Coverage comes in two layers:
//   • The named describe blocks below run the full 3-case matrix — unauth →
//     401, admin-without-CSRF → 403, admin+CSRF → happy path with the repo/
//     service called exactly once — for the viewRoutes/adminRoutes mutations.
//   • The "runtime guard matrix" block at the bottom discovers EVERY
//     admin-guarded mutation route across all six routers (viewRoutes,
//     adminRoutes, gameRoutes, pointsRoutes, tourneyRoutes, conferenceRoutes)
//     from the live router stacks and executes the 401/403 cases against each,
//     so a new or existing route whose guards regress at runtime fails here
//     even without a hand-written happy-path test.
//
// The routers, guards, and controllers are real; only the service/repo data
// layer is mocked (no live Firestore). No supertest — the app is served on an
// ephemeral port and driven with global fetch.

import express from 'express';
import { createServer } from 'node:http';

vi.mock('../src/repositories/index.js', () => ({
  entryRepository: {
    deleteEntry: vi.fn(),
    restoreEntry: vi.fn(),
    purgeEntry: vi.fn(),
    getDeletedEntries: vi.fn(),
    getUnpaidEntriesForGroup: vi.fn(),
  },
  viewRepository: {
    getAllGroups: vi.fn(),
    findGroupByName: vi.fn(),
    getMaxGroupId: vi.fn(),
    addGroup: vi.fn(),
  },
  gameRepository: {
    getEntryById: vi.fn(),
    updateEntry: vi.fn(),
    getEntriesByEmail: vi.fn(),
    getAllTournamentDetails: vi.fn(),
    getActiveGames: vi.fn(),
    getFirstFourGames: vi.fn(),
  },
  teamRepository: {
    getSchoolById: vi.fn(),
    getAllSchools: vi.fn(),
    findSchoolsByName: vi.fn(),
    getMaxSchoolId: vi.fn(),
    insertSchool: vi.fn(),
    deleteSchool: vi.fn(),
    updateSchool: vi.fn(),
    updateSchoolConferenceHistory: vi.fn(),
    updateSchoolEspn: vi.fn(),
  },
  conferenceRepository: {
    getAllConferences: vi.fn(),
    getConferenceBySlug: vi.fn(),
    updateConference: vi.fn(),
    insertConference: vi.fn(),
  },
  tourneyRepository: {},
  sessionRepository: {
    clearAuthenticatedSessions: vi.fn(),
  },
}));

vi.mock('../src/services/index.js', () => ({
  calculateMaxPossiblePoints: vi.fn(),
  verifyGroupExists: vi.fn(),
  getEntryIdsForUserInGroup: vi.fn(),
  buildFullGridData: vi.fn(),
  buildGameViewData: vi.fn(),
  getGroupRegistrationData: vi.fn(),
  createNewEntry: vi.fn(),
  normalizeAndValidateEntryPicks: vi.fn(),
  findEntriesByName: vi.fn(),
  addNewGroup: vi.fn(),
  normalizeFirstFourPicks: vi.fn(),
  getUnsentEmailEntries: vi.fn(),
  markEmailsSent: vi.fn(),
  updatePointsForAffectedEntries: vi.fn(),
  getEntriesForUser: vi.fn(),
  getTournamentData: vi.fn(),
  getBudgetStatus: vi.fn(),
  triggerProductionDeploy: vi.fn(),
  getCloudConsoleLinks: vi.fn(),
  updateTeamRecords: vi.fn(),
  undoTeamRecords: vi.fn(),
  runEspnPoll: vi.fn(),
  updatePossiblePoints: vi.fn(),
  possibleRanking: vi.fn(),
  prepareRegionVerifyData: vi.fn(),
  prepareNewTournamentData: vi.fn(),
  createNewBracket: vi.fn(),
  updateBracket: vi.fn(),
  updateEntrywithNewSchools: vi.fn(),
  deleteTournament: vi.fn(),
}));

import viewRoutes from '../src/routes/viewRoutes.js';
import adminRoutes from '../src/routes/adminRoutes.js';
import gameRoutes from '../src/routes/gameRoutes.js';
import pointsRoutes from '../src/routes/pointsRoutes.js';
import tourneyRoutes from '../src/routes/tourneyRoutes.js';
import conferenceRoutes from '../src/routes/conferenceRoutes.js';
import { requireSiteAdmin } from '../src/middleware/adminMiddleware.js';
import {
  entryRepository,
  teamRepository,
  gameRepository,
} from '../src/repositories/index.js';
import {
  verifyGroupExists,
  addNewGroup,
  markEmailsSent,
  normalizeFirstFourPicks,
  calculateMaxPossiblePoints,
  triggerProductionDeploy,
} from '../src/services/index.js';
import { ValidationError } from '../src/utils/errors.js';

const CSRF_TOKEN = 'test-csrf-token';
const ADMIN_SESSION = { siteAdmin: true, csrfToken: CSRF_TOKEN };

// Per-request session, assigned by each test before firing the request. This
// stands in for express-session so the real guards read exactly the session
// shape production hands them.
let session;

let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    req.session = session;
    // Locals normally set by global middleware in server.js; the confirm view's
    // header partial reads them on the entryUpdate happy path.
    res.locals.cspNonce = 'test-nonce';
    res.locals.gaMeasurementId = '';
    next();
  });
  app.set('view engine', 'ejs');
  app.set('views', 'views');
  app.use('/', viewRoutes);
  app.use('/', adminRoutes);
  app.use('/', gameRoutes);
  app.use('/', pointsRoutes);
  app.use('/', tourneyRoutes);
  app.use('/', conferenceRoutes);

  server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  vi.clearAllMocks();
  session = undefined;
});

async function post(path, { body = {}, csrf, asAdmin = false } = {}) {
  session = asAdmin ? { ...ADMIN_SESSION } : undefined;
  const headers = { 'content-type': 'application/json' };
  if (csrf) headers['x-csrf-token'] = csrf;
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await res.text();
  return { status: res.status, location: res.headers.get('location'), text };
}

// One block per admin mutation route. The 401 and 403 cases are the
// highest-value assertions: they catch the exact regression that silently
// disables a guard while the route keeps "working" for the admin who tests it
// logged in from the console.
describe('POST /deleteEntry', () => {
  const body = { entryId: '42', year: '2024' };

  test('no admin session → 401 and the repo is never touched', async () => {
    const res = await post('/deleteEntry', { body });
    expect(res.status).toBe(401);
    expect(entryRepository.deleteEntry).not.toHaveBeenCalled();
  });

  test('admin without CSRF token → 403 and the repo is never touched', async () => {
    const res = await post('/deleteEntry', { body, asAdmin: true });
    expect(res.status).toBe(403);
    expect(entryRepository.deleteEntry).not.toHaveBeenCalled();
  });

  test('admin with valid CSRF → deletes exactly once and redirects', async () => {
    entryRepository.deleteEntry.mockResolvedValue();
    const res = await post('/deleteEntry', {
      body,
      asAdmin: true,
      csrf: CSRF_TOKEN,
    });
    expect(res.status).toBe(302);
    expect(res.location).toBe('/updates');
    expect(entryRepository.deleteEntry).toHaveBeenCalledExactlyOnceWith(
      42,
      2024,
    );
  });

  test("admin with valid CSRF → propagates 400 when the entry doesn't exist", async () => {
    entryRepository.deleteEntry.mockRejectedValue(
      new ValidationError('Entry not found.', 'entryId'),
    );
    const res = await post('/deleteEntry', {
      body,
      asAdmin: true,
      csrf: CSRF_TOKEN,
    });
    expect(res.status).toBe(400);
  });
});

// The `post()` helper always sends application/json, so these hit the
// req.is('json') branch and get a JSON response rather than the redirect a
// real HTML form submit from editEntry.ejs would receive.
describe('POST /restoreEntry', () => {
  const body = { entryId: '42', year: '2024' };

  test('no admin session → 401 and the repo is never touched', async () => {
    const res = await post('/restoreEntry', { body });
    expect(res.status).toBe(401);
    expect(entryRepository.restoreEntry).not.toHaveBeenCalled();
  });

  test('admin without CSRF token → 403 and the repo is never touched', async () => {
    const res = await post('/restoreEntry', { body, asAdmin: true });
    expect(res.status).toBe(403);
    expect(entryRepository.restoreEntry).not.toHaveBeenCalled();
  });

  test('admin with valid CSRF → restores exactly once and returns JSON success', async () => {
    entryRepository.restoreEntry.mockResolvedValue();
    const res = await post('/restoreEntry', {
      body,
      asAdmin: true,
      csrf: CSRF_TOKEN,
    });
    expect(res.status).toBe(200);
    expect(entryRepository.restoreEntry).toHaveBeenCalledExactlyOnceWith(
      42,
      2024,
    );
    expect(JSON.parse(res.text)).toMatchObject({ success: true });
  });

  test("admin with valid CSRF → propagates 400 when the entry doesn't exist", async () => {
    entryRepository.restoreEntry.mockRejectedValue(
      new ValidationError('Entry not found.', 'entryId'),
    );
    const res = await post('/restoreEntry', {
      body,
      asAdmin: true,
      csrf: CSRF_TOKEN,
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /purgeEntry', () => {
  const body = { entryId: '42', year: '2024' };

  test('no admin session → 401 and the repo is never touched', async () => {
    const res = await post('/purgeEntry', { body });
    expect(res.status).toBe(401);
    expect(entryRepository.purgeEntry).not.toHaveBeenCalled();
  });

  test('admin without CSRF token → 403 and the repo is never touched', async () => {
    const res = await post('/purgeEntry', { body, asAdmin: true });
    expect(res.status).toBe(403);
    expect(entryRepository.purgeEntry).not.toHaveBeenCalled();
  });

  test('admin with valid CSRF → purges exactly once and returns JSON success', async () => {
    entryRepository.purgeEntry.mockResolvedValue();
    const res = await post('/purgeEntry', {
      body,
      asAdmin: true,
      csrf: CSRF_TOKEN,
    });
    expect(res.status).toBe(200);
    expect(entryRepository.purgeEntry).toHaveBeenCalledExactlyOnceWith(
      42,
      2024,
    );
    expect(JSON.parse(res.text)).toMatchObject({ success: true });
  });

  test("admin with valid CSRF → propagates 400 when the entry hasn't been soft-deleted yet", async () => {
    entryRepository.purgeEntry.mockRejectedValue(
      new ValidationError(
        'Entry must be soft-deleted before it can be permanently deleted.',
        'entryId',
      ),
    );
    const res = await post('/purgeEntry', {
      body,
      asAdmin: true,
      csrf: CSRF_TOKEN,
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /entryUpdate', () => {
  const body = {
    entryId: '7',
    email: 'a@b.c',
    year: '2024',
    team: 'Team X',
    name: 'Alice',
    groups: 'G',
    teamSelect1: '5, Duke',
  };

  test('no admin session → 401', async () => {
    const res = await post('/entryUpdate', { body });
    expect(res.status).toBe(401);
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  test('admin without CSRF token → 403', async () => {
    const res = await post('/entryUpdate', { body, asAdmin: true });
    expect(res.status).toBe(403);
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  test('admin with valid CSRF → updates the entry once and renders the confirmation', async () => {
    normalizeFirstFourPicks.mockResolvedValue([5]);
    calculateMaxPossiblePoints.mockResolvedValue(100);
    gameRepository.updateEntry.mockResolvedValue();

    const res = await post('/entryUpdate', {
      body,
      asAdmin: true,
      csrf: CSRF_TOKEN,
    });

    expect(res.status).toBe(200);
    expect(gameRepository.updateEntry).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: '7',
        email: 'a@b.c',
        teamName: 'Team X',
        person: 'Alice',
        groups: ['G'],
        picks: [5],
        possPoints: 100,
      }),
    );
  });
});

describe('POST /newGroup', () => {
  const body = { groupName: 'FreshGroup' };

  test('no admin session → 401', async () => {
    const res = await post('/newGroup', { body });
    expect(res.status).toBe(401);
    expect(addNewGroup).not.toHaveBeenCalled();
  });

  test('admin without CSRF token → 403', async () => {
    const res = await post('/newGroup', { body, asAdmin: true });
    expect(res.status).toBe(403);
    expect(addNewGroup).not.toHaveBeenCalled();
  });

  test('admin with valid CSRF → creates the group once and returns 201', async () => {
    verifyGroupExists.mockResolvedValue(null);
    addNewGroup.mockResolvedValue();
    const res = await post('/newGroup', {
      body,
      asAdmin: true,
      csrf: CSRF_TOKEN,
    });
    expect(res.status).toBe(201);
    expect(addNewGroup).toHaveBeenCalledExactlyOnceWith('FreshGroup');
  });
});

describe('POST /admin/mark-emails-sent', () => {
  const body = { year: 2024, entryIds: ['1', '2'] };

  test('no admin session → 401', async () => {
    const res = await post('/admin/mark-emails-sent', { body });
    expect(res.status).toBe(401);
    expect(markEmailsSent).not.toHaveBeenCalled();
  });

  test('admin without CSRF token → 403', async () => {
    const res = await post('/admin/mark-emails-sent', { body, asAdmin: true });
    expect(res.status).toBe(403);
    expect(markEmailsSent).not.toHaveBeenCalled();
  });

  test('admin with valid CSRF → marks the entries once', async () => {
    markEmailsSent.mockResolvedValue();
    const res = await post('/admin/mark-emails-sent', {
      body,
      asAdmin: true,
      csrf: CSRF_TOKEN,
    });
    expect(res.status).toBe(200);
    expect(markEmailsSent).toHaveBeenCalledExactlyOnceWith(['1', '2'], 2024);
  });
});

describe('POST /updateTeam', () => {
  const body = {
    sid: '7',
    name: 'Duke',
    mascot: 'Blue Devils',
    nameNick: 'Duke',
    confID: 'acc',
  };

  test('no admin session → 401', async () => {
    const res = await post('/updateTeam', { body });
    expect(res.status).toBe(401);
    expect(teamRepository.updateSchool).not.toHaveBeenCalled();
  });

  test('admin without CSRF token → 403', async () => {
    const res = await post('/updateTeam', { body, asAdmin: true });
    expect(res.status).toBe(403);
    expect(teamRepository.updateSchool).not.toHaveBeenCalled();
  });

  test('admin with valid CSRF → updates the school once and redirects to its page', async () => {
    teamRepository.updateSchool.mockResolvedValue();
    const res = await post('/updateTeam', {
      body,
      asAdmin: true,
      csrf: CSRF_TOKEN,
    });
    expect(res.status).toBe(302);
    expect(res.location).toBe('/viewTeam?teamId=7');
    expect(teamRepository.updateSchool).toHaveBeenCalledExactlyOnceWith({
      sid: 7,
      name: 'Duke',
      mascot: 'Blue Devils',
      nameNick: 'Duke',
      confID: 'acc',
    });
  });
});

describe('POST /addTeam', () => {
  const body = { name: 'New University', mascot: 'News', nameNick: 'New U' };

  test('no admin session → 401', async () => {
    const res = await post('/addTeam', { body });
    expect(res.status).toBe(401);
    expect(teamRepository.insertSchool).not.toHaveBeenCalled();
  });

  test('admin without CSRF token → 403', async () => {
    const res = await post('/addTeam', { body, asAdmin: true });
    expect(res.status).toBe(403);
    expect(teamRepository.insertSchool).not.toHaveBeenCalled();
  });

  test('admin with valid CSRF → inserts with the next sid and redirects', async () => {
    teamRepository.getMaxSchoolId.mockResolvedValue(400);
    teamRepository.insertSchool.mockResolvedValue();
    const res = await post('/addTeam', {
      body,
      asAdmin: true,
      csrf: CSRF_TOKEN,
    });
    expect(res.status).toBe(302);
    expect(res.location).toBe('/viewTeam?teamId=401');
    expect(teamRepository.insertSchool).toHaveBeenCalledExactlyOnceWith({
      sid: 401,
      name: 'New University',
      mascot: 'News',
      nameNick: 'New U',
      confID: null,
    });
  });
});

describe('POST /api/addTeam', () => {
  const body = { name: 'New University' };

  test('no admin session → 401', async () => {
    const res = await post('/api/addTeam', { body });
    expect(res.status).toBe(401);
  });

  test('admin without CSRF token → 403', async () => {
    const res = await post('/api/addTeam', { body, asAdmin: true });
    expect(res.status).toBe(403);
  });

  test('admin with valid CSRF → inserts once and returns 201 JSON with the new sid', async () => {
    teamRepository.getMaxSchoolId.mockResolvedValue(400);
    teamRepository.insertSchool.mockResolvedValue();
    const res = await post('/api/addTeam', {
      body,
      asAdmin: true,
      csrf: CSRF_TOKEN,
    });
    expect(res.status).toBe(201);
    expect(JSON.parse(res.text)).toMatchObject({
      sid: 401,
      name: 'New University',
    });
    expect(teamRepository.insertSchool).toHaveBeenCalledTimes(1);
  });
});

describe('POST /deleteTeam', () => {
  const body = { sid: '7' };

  test('no admin session → 401', async () => {
    const res = await post('/deleteTeam', { body });
    expect(res.status).toBe(401);
    expect(teamRepository.deleteSchool).not.toHaveBeenCalled();
  });

  test('admin without CSRF token → 403', async () => {
    const res = await post('/deleteTeam', { body, asAdmin: true });
    expect(res.status).toBe(403);
    expect(teamRepository.deleteSchool).not.toHaveBeenCalled();
  });

  test('admin with valid CSRF → deletes the school once and redirects', async () => {
    teamRepository.deleteSchool.mockResolvedValue();
    const res = await post('/deleteTeam', {
      body,
      asAdmin: true,
      csrf: CSRF_TOKEN,
    });
    expect(res.status).toBe(302);
    expect(res.location).toBe('/updates');
    expect(teamRepository.deleteSchool).toHaveBeenCalledExactlyOnceWith(7);
  });
});

describe('POST /admin/cloud/deploy', () => {
  test('no admin session → 401', async () => {
    const res = await post('/admin/cloud/deploy');
    expect(res.status).toBe(401);
    expect(triggerProductionDeploy).not.toHaveBeenCalled();
  });

  test('admin without CSRF token → 403', async () => {
    const res = await post('/admin/cloud/deploy', { asAdmin: true });
    expect(res.status).toBe(403);
    expect(triggerProductionDeploy).not.toHaveBeenCalled();
  });

  test('admin with valid CSRF → triggers the deploy once', async () => {
    triggerProductionDeploy.mockResolvedValue({ ok: true, buildId: 'b1' });
    const res = await post('/admin/cloud/deploy', {
      asAdmin: true,
      csrf: CSRF_TOKEN,
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toMatchObject({ ok: true });
    expect(triggerProductionDeploy).toHaveBeenCalledTimes(1);
  });
});

describe('POST /admin/logout', () => {
  // Unlike the other routes above, this one isn't admin-guarded (a stale/expired
  // admin session must still be able to log itself out), so it needs its own
  // session objects with real save/destroy mocks rather than the post() helper's
  // ADMIN_SESSION shape.
  test('destroys the session and redirects to /updates', async () => {
    session = {
      siteAdmin: true,
      adminEmail: 'admin@x.com',
      destroy: vi.fn((cb) => cb()),
      save: vi.fn((cb) => cb()),
    };
    const res = await fetch(`${baseUrl}/admin/logout`, {
      method: 'POST',
      redirect: 'manual',
    });
    await res.text();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/updates');
    expect(session.destroy).toHaveBeenCalled();
  });

  test('session.destroy failing → 500, not a redirect that pretends logout succeeded (#368)', async () => {
    session = {
      siteAdmin: true,
      destroy: vi.fn((cb) => cb(new Error('store unavailable'))),
      save: vi.fn((cb) => cb()),
    };
    const res = await fetch(`${baseUrl}/admin/logout`, {
      method: 'POST',
      redirect: 'manual',
    });
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).toBe('Logout failed');
  });

  // The two tests above only exercise the destroy() branch (no userEmail on the
  // session). These cover the save() branch — an admin logging out while a
  // participant session coexists — which was previously untested for either
  // outcome (pr-debate review on #420).
  test('saves the session and redirects to /updates when a participant session coexists', async () => {
    session = {
      siteAdmin: true,
      userEmail: 'player@x.com',
      destroy: vi.fn((cb) => cb()),
      save: vi.fn((cb) => cb()),
    };
    const res = await fetch(`${baseUrl}/admin/logout`, {
      method: 'POST',
      redirect: 'manual',
    });
    await res.text();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/updates');
    expect(session.save).toHaveBeenCalled();
  });

  test('session.save failing (userEmail present) → 500, not a redirect that pretends logout succeeded (#368)', async () => {
    session = {
      siteAdmin: true,
      userEmail: 'player@x.com',
      destroy: vi.fn((cb) => cb()),
      save: vi.fn((cb) => cb(new Error('store unavailable'))),
    };
    const res = await fetch(`${baseUrl}/admin/logout`, {
      method: 'POST',
      redirect: 'manual',
    });
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).toBe('Logout failed');
  });
});

describe('verifyCsrf token handling', () => {
  // Note: a black-box 403 can't prove the comparison is timing-safe (that's
  // internal to verifyCsrf); this only proves a same-length wrong VALUE is
  // rejected, i.e. the check isn't merely a length check.
  test('a wrong token of the same length as the real one is rejected', async () => {
    entryRepository.deleteEntry.mockResolvedValue();
    const res = await post('/deleteEntry', {
      body: { entryId: '42', year: '2024' },
      asAdmin: true,
      csrf: 'x'.repeat(CSRF_TOKEN.length),
    });
    expect(res.status).toBe(403);
    expect(entryRepository.deleteEntry).not.toHaveBeenCalled();
  });

  test('the _csrf body field works as an alternative to the header (HTML form path)', async () => {
    entryRepository.deleteEntry.mockResolvedValue();
    const res = await post('/deleteEntry', {
      body: { entryId: '42', year: '2024', _csrf: CSRF_TOKEN },
      asAdmin: true,
    });
    expect(res.status).toBe(302);
    expect(entryRepository.deleteEntry).toHaveBeenCalledTimes(1);
  });
});

// A GET admin page must redirect (not 401-JSON) so a logged-out admin landing
// on a bookmark gets the public page instead of raw JSON.
describe('GET admin routes', () => {
  test('GET /viewEntry without a session redirects to /updates', async () => {
    session = undefined;
    const res = await fetch(`${baseUrl}/viewEntry`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/updates');
    await res.text();
  });
});

// ── Runtime guard matrix for the FULL admin mutation surface ──────────────
// Discovers every admin-guarded mutation route from the live router stacks —
// the same stacks production mounts — and executes the two highest-value
// cases (unauth → 401, admin-without-CSRF → 403) against each over HTTP.
// Unlike the static inspection in routes.test.js, this proves the guards
// actually short-circuit at runtime; and being discovery-based, a route added
// to any of these routers later is covered automatically. The 403 expectation
// doubles as a CSRF-presence check: an admin mutation route missing verifyCsrf
// would fall through to its controller and not return 403.
const routerStacks = {
  viewRoutes,
  adminRoutes,
  gameRoutes,
  pointsRoutes,
  tourneyRoutes,
  conferenceRoutes,
};

const MUTATION_METHODS = ['post', 'put', 'delete', 'patch'];
const adminMutationRoutes = [];
for (const [routerName, router] of Object.entries(routerStacks)) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    if (!MUTATION_METHODS.some((m) => layer.route.methods[m])) continue;
    if (!layer.route.stack.some((l) => l.handle === requireSiteAdmin)) continue;
    adminMutationRoutes.push({ routerName, path: layer.route.path });
  }
}

describe('runtime guard matrix — every admin mutation route in every router', () => {
  test('discovers the expected admin mutation surface (guards against silent shrinkage)', () => {
    // 8 viewRoutes + 1 adminRoutes + 4 gameRoutes + 5 pointsRoutes +
    // 9 tourneyRoutes + 2 conferenceRoutes as of #311. Grows as routes are added.
    expect(adminMutationRoutes.length).toBeGreaterThanOrEqual(29);
  });

  for (const { routerName, path } of adminMutationRoutes) {
    test(`POST ${path} (${routerName}): unauth → 401, admin without CSRF → 403`, async () => {
      const unauth = await post(path);
      expect(unauth.status).toBe(401);

      const noCsrf = await post(path, { asAdmin: true });
      expect(noCsrf.status).toBe(403);
    });
  }
});
