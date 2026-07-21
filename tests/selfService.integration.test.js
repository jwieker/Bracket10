// #301 pr-debate should-fix — HTTP-level coverage for the CSRF guard on
// POST /my-entry/update. tests/csrf.test.js exercises attachCsrfToken/
// verifyCsrf directly and tests/routes.test.js checks static route
// composition, but neither actually runs the request through Express the
// way tests/admin.integration.test.js does for admin mutations. This drives
// the real router + real verifyCsrf middleware + real controller over HTTP
// (only the repo/service data layer is mocked), so a future edit that drops
// verifyCsrf from the route — the exact regression #301 fixed — fails here.

import express from 'express';
import { createServer } from 'node:http';

vi.mock('../src/repositories/index.js', () => ({
  gameRepository: {
    getEntryById: vi.fn(),
    updateEntry: vi.fn(),
    getEntriesByEmail: vi.fn(),
    getAllTournamentDetails: vi.fn(),
    getActiveGames: vi.fn(),
    getFirstFourGames: vi.fn(),
  },
  entryRepository: {},
  viewRepository: {},
  teamRepository: {},
  conferenceRepository: {},
  tourneyRepository: {},
  sessionRepository: {},
}));

vi.mock('../src/services/index.js', () => ({
  normalizeAndValidateEntryPicks: vi.fn(),
  resolveConfirmedPickNames: vi.fn(async (_ids, _normIds, names) => names),
  calculateMaxPossiblePoints: vi.fn(),
  getGroupRegistrationData: vi.fn(),
  verifyGroupExists: vi.fn(),
  getEntryIdsForUserInGroup: vi.fn(),
  buildFullGridData: vi.fn(),
  buildGameViewData: vi.fn(),
  createNewEntry: vi.fn(),
  findEntriesByName: vi.fn(),
  addNewGroup: vi.fn(),
  normalizeFirstFourPicks: vi.fn(),
  getUnsentEmailEntries: vi.fn(),
  markEmailsSent: vi.fn(),
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
import { gameRepository } from '../src/repositories/index.js';
import {
  normalizeAndValidateEntryPicks,
  calculateMaxPossiblePoints,
} from '../src/services/index.js';

const CSRF_TOKEN = 'test-csrf-token';
const YEAR = '2027'; // Must match thisYear in test mode
const ENTRY_ID = '42';
const SESSION_KEY = `${YEAR}:${ENTRY_ID}`;

let session;
let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    req.session = session;
    res.locals.cspNonce = 'test-nonce';
    res.locals.gaMeasurementId = '';
    next();
  });
  app.set('view engine', 'ejs');
  app.set('views', 'views');
  app.use('/', viewRoutes);

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

async function postUpdate({ verified = false, csrf, extraBody = {} } = {}) {
  session = verified
    ? { verifiedEntries: { [SESSION_KEY]: true }, csrfToken: CSRF_TOKEN }
    : undefined;
  const body = new URLSearchParams({
    entryId: ENTRY_ID,
    year: YEAR,
    ...extraBody,
  });
  if (csrf) body.set('_csrf', csrf);
  const res = await fetch(`${baseUrl}/my-entry/update`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    redirect: 'manual',
  });
  const text = await res.text();
  return { status: res.status, location: res.headers.get('location'), text };
}

describe('POST /my-entry/update — CSRF guard (#301)', () => {
  test('no session at all → 403 from verifyCsrf, controller never reached', async () => {
    const res = await postUpdate({ verified: false });
    expect(res.status).toBe(403);
    expect(gameRepository.getEntryById).not.toHaveBeenCalled();
  });

  test('verified session but missing/wrong CSRF token → 403, controller never reached', async () => {
    const res = await postUpdate({ verified: true, csrf: 'wrong-token' });
    expect(res.status).toBe(403);
    expect(gameRepository.getEntryById).not.toHaveBeenCalled();
  });

  test('verified session with valid CSRF but entry not owned by this session → redirects, never writes', async () => {
    // Same CSRF token, but the session's verifiedEntries key doesn't match this
    // entryId/year — proves the CSRF guard and the controller's own ownership
    // check are independent layers.
    session = { verifiedEntries: { '2025:99': true }, csrfToken: CSRF_TOKEN };
    const body = new URLSearchParams({
      entryId: ENTRY_ID,
      year: YEAR,
      _csrf: CSRF_TOKEN,
    });
    const res = await fetch(`${baseUrl}/my-entry/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/my-entry');
    await res.text();
    expect(gameRepository.getEntryById).not.toHaveBeenCalled();
  });

  test('verified session with valid CSRF → updates the entry once and renders the confirmation', async () => {
    gameRepository.getEntryById.mockResolvedValue({
      id: ENTRY_ID,
      email: 'a@b.c',
      groups: ['G'],
      hasPaid: false,
    });
    normalizeAndValidateEntryPicks.mockResolvedValue([5]);
    calculateMaxPossiblePoints.mockResolvedValue(100);
    gameRepository.updateEntry.mockResolvedValue();

    const res = await postUpdate({
      verified: true,
      csrf: CSRF_TOKEN,
      extraBody: { name: 'Alice', team: 'Team X', teamSelect1: '5, Duke' },
    });

    expect(res.status).toBe(200);
    expect(gameRepository.updateEntry).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: ENTRY_ID,
        email: 'a@b.c',
        teamName: 'Team X',
        person: 'Alice',
        picks: [5],
        possPoints: 100,
      }),
    );
  });
});
