import {
  myEntryLookup,
  myEntryVerify,
  myEntryView,
  myEntryUpdate,
  myBrackets,
  userEntryView,
  userEntryUpdate,
} from '../src/controllers/selfServiceController.js';

vi.mock('../src/services/index.js', () => ({
  getGroupTeamDetails: vi.fn(),
  addTeamProgressforGroup: vi.fn(),
  verifyGroupExists: vi.fn(),
  getGroupRegistrationData: vi.fn(),
  normalizeFirstFourPicks: vi.fn(),
  validateEntryPicks: vi.fn(),
  normalizeAndValidateEntryPicks: vi.fn(),
  // Passthrough by default: tests that don't exercise #375 keep seeing the
  // submitted names on the confirm render.
  resolveConfirmedPickNames: vi.fn(async (_ids, _normIds, names) => names),
  createNewEntry: vi.fn(),
  addPickCount: vi.fn(),
  calculateMaxPossiblePoints: vi.fn(),
  getAllYearsforGroup: vi.fn(),
  getEntriesForUser: vi.fn(),
  getEntryIdsForUserInGroup: vi.fn(),
  findEntriesByName: vi.fn(),
  addNewGroup: vi.fn(),
  buildFullGridData: vi.fn(),
  buildGameViewData: vi.fn(),
  getUnsentEmailEntries: vi.fn(),
  markEmailsSent: vi.fn(),
}));
vi.mock('../src/repositories/index.js', () => ({
  gameRepository: { getEntryById: vi.fn(), updateEntry: vi.fn() },
  teamRepository: {
    getAllSchools: vi.fn(),
    getSchoolById: vi.fn(),
    findSchoolsByName: vi.fn(),
    getMaxSchoolId: vi.fn(),
    insertSchool: vi.fn(),
    deleteSchool: vi.fn(),
    updateSchool: vi.fn(),
    updateSchoolConferenceHistory: vi.fn(),
  },
  entryRepository: { getUnpaidEntriesForGroup: vi.fn(), deleteEntry: vi.fn() },
  viewRepository: { getAllGroups: vi.fn() },
  conferenceRepository: { getAllConferences: vi.fn() },
}));
vi.mock('../src/config/app.js', () => ({
  thisYear: 2024,
  isRegistrationOpen: vi.fn(() => true),
  APP_CONFIG: {
    tournament: {
      paymentCollectorGroup: '',
      priorityGroups: [],
      defaultGroup: 'Default',
    },
    payments: { collectorName: '', collectorEmail: '', collectorPhone: '' },
  },
}));
vi.mock('../src/middleware/rateLimit.js', () => ({
  reserveVerificationAttempt: vi.fn(async () => false),
}));

import {
  getEntriesForUser,
  getGroupRegistrationData,
  calculateMaxPossiblePoints,
  normalizeFirstFourPicks,
  normalizeAndValidateEntryPicks,
  resolveConfirmedPickNames,
} from '../src/services/index.js';
import { gameRepository } from '../src/repositories/index.js';
import { isRegistrationOpen, APP_CONFIG } from '../src/config/app.js';
import { reserveVerificationAttempt } from '../src/middleware/rateLimit.js';
import { ValidationError } from '../src/utils/errors.js';

function mockRes() {
  return {
    render: vi.fn(),
    redirect: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    send: vi.fn(),
    set: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  APP_CONFIG.tournament.paymentCollectorGroup = 'Family';
  APP_CONFIG.tournament.priorityGroups = ['Family', 'House'];
  // The pick pipeline lives in the service layer; default both the low-level FF
  // normalizer and the full pipeline to identity passthroughs. Tests needing a
  // rule violation override normalizeAndValidateEntryPicks to throw.
  normalizeFirstFourPicks.mockImplementation(async (picks) => [...picks]);
  normalizeAndValidateEntryPicks.mockImplementation(async (picks) => [
    ...picks,
  ]);
});

const tenPickIds = Array.from({ length: 10 }, (_, i) => 101 + i);
const tenPickSelections = Object.fromEntries(
  tenPickIds.map((sID, i) => [`teamSelect${i + 1}`, `${sID}, Team ${sID}`]),
);
const tenPickTeamData = tenPickIds.map((sID, i) => ({
  sID,
  nameNick: `Team ${sID}`,
  seed: i + 1,
  regionName: 'East',
}));

describe('myEntryLookup', () => {
  test('returns 403 when registration is closed', async () => {
    isRegistrationOpen.mockReturnValue(false);
    const req = { query: {}, method: 'GET', url: '/my-entry' };
    const res = mockRes();
    await myEntryLookup(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.render).toHaveBeenCalledWith('myEntryClosed');
  });

  test('renders myEntryLookup when registration is open', async () => {
    isRegistrationOpen.mockReturnValue(true);
    const req = { query: {}, method: 'GET', url: '/my-entry' };
    const res = mockRes();
    await myEntryLookup(req, res);
    expect(res.render).toHaveBeenCalledWith(
      'myEntryLookup',
      expect.objectContaining({ currentYear: 2024 }),
    );
  });

  test('passes error query param to view', async () => {
    isRegistrationOpen.mockReturnValue(true);
    const req = {
      query: { error: 'notfound' },
      method: 'GET',
      url: '/my-entry',
    };
    const res = mockRes();
    await myEntryLookup(req, res);
    expect(res.render).toHaveBeenCalledWith(
      'myEntryLookup',
      expect.objectContaining({ error: 'notfound' }),
    );
  });

  test('passes entryId and year query params to view for pre-fill', async () => {
    isRegistrationOpen.mockReturnValue(true);
    const req = {
      query: { entryId: 'abc123', year: '2024' },
      method: 'GET',
      url: '/my-entry',
    };
    const res = mockRes();
    await myEntryLookup(req, res);
    expect(res.render).toHaveBeenCalledWith(
      'myEntryLookup',
      expect.objectContaining({ entryId: 'abc123', year: '2024' }),
    );
  });
});

// ---------------------------------------------------------------------------
// myEntryVerify
// ---------------------------------------------------------------------------

describe('myEntryVerify', () => {
  beforeEach(() => {
    isRegistrationOpen.mockReturnValue(true);
  });

  test('returns 403 when registration is closed', async () => {
    isRegistrationOpen.mockReturnValue(false);
    const req = {
      body: { entryId: '1', year: '2024', email: 'a@b.com' },
      session: {},
      method: 'POST',
      url: '/my-entry/verify',
    };
    const res = mockRes();
    await myEntryVerify(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.render).toHaveBeenCalledWith('myEntryClosed');
  });

  test('returns 400 when email is missing', async () => {
    const req = {
      body: { entryId: '1', year: '2024' },
      session: {},
      method: 'POST',
      url: '/my-entry/verify',
    };
    const res = mockRes();
    await myEntryVerify(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('redirects with error=invalid when entry not found', async () => {
    gameRepository.getEntryById.mockResolvedValue(null);
    const req = {
      body: { entryId: '999999', year: '2024', email: 'a@b.com' },
      session: {},
      method: 'POST',
      url: '/my-entry/verify',
    };
    const res = mockRes();
    await myEntryVerify(req, res);
    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining('error=invalid'),
    );
  });

  test('returns 400 for a malformed entryId (path-traversal shape) without querying the repository', async () => {
    const req = {
      body: { entryId: 'x/schoolRecords/y', year: '2024', email: 'a@b.com' },
      session: {},
      method: 'POST',
      url: '/my-entry/verify',
    };
    const res = mockRes();
    await myEntryVerify(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(gameRepository.getEntryById).not.toHaveBeenCalled();
  });

  test('redirects with error=invalid when email does not match', async () => {
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'real@b.com',
    });
    const req = {
      body: { entryId: '1', year: '2024', email: 'wrong@b.com' },
      session: {},
      method: 'POST',
      url: '/my-entry/verify',
    };
    const res = mockRes();
    await myEntryVerify(req, res);
    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining('error=invalid'),
    );
  });

  test('redirects with error=invalid for a soft-deleted entry even with the correct email (#310)', async () => {
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'real@b.com',
      deletedAt: '2024-03-01T00:00:00.000Z',
    });
    const session = {
      regenerate: vi.fn((cb) => cb(null)),
      save: vi.fn((cb) => cb(null)),
    };
    const req = {
      body: { entryId: '1', year: '2024', email: 'real@b.com' },
      session,
      method: 'POST',
      url: '/my-entry/verify',
    };
    const res = mockRes();
    await myEntryVerify(req, res);
    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining('error=invalid'),
    );
    expect(session.regenerate).not.toHaveBeenCalled();
  });

  test('not-found and email-mismatch produce an identical response (no existence oracle — #166)', async () => {
    // Same entryId/year/email for both cases so the redirect query string
    // (which echoes them) is directly comparable; the only difference is whether
    // the entry exists. The responses must be byte-identical so the endpoint
    // can't be used to probe which entry IDs exist.
    const body = { entryId: '1', year: '2024', email: 'wrong@b.com' };

    gameRepository.getEntryById.mockResolvedValue(null); // not found
    const resNotFound = mockRes();
    await myEntryVerify(
      { body, session: {}, method: 'POST', url: '/my-entry/verify' },
      resNotFound,
    );

    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'real@b.com',
    }); // exists, wrong email
    const resMismatch = mockRes();
    await myEntryVerify(
      { body, session: {}, method: 'POST', url: '/my-entry/verify' },
      resMismatch,
    );

    // Neither short-circuits to a distinguishable branch: same redirect target,
    // and neither sets a status (both fall through to the same 302 redirect).
    expect(resNotFound.redirect.mock.calls).toEqual(
      resMismatch.redirect.mock.calls,
    );
    expect(resNotFound.status.mock.calls).toEqual(
      resMismatch.status.mock.calls,
    );
    expect(resNotFound.render.mock.calls).toEqual(
      resMismatch.render.mock.calls,
    );
  });

  test('a whitespace email never authenticates against an entry with empty/null stored email (#166)', async () => {
    // Both submitted and stored normalize to '' under trim+lowercase; the
    // `!!entryData?.email` guard must reject the match rather than grant access.
    for (const storedEmail of ['', null, undefined]) {
      gameRepository.getEntryById.mockResolvedValue({
        id: '1',
        email: storedEmail,
      });
      const session = {
        regenerate: vi.fn((cb) => cb(null)),
        save: vi.fn((cb) => cb(null)),
      };
      const req = {
        body: { entryId: '1', year: '2024', email: '   ' },
        session,
        method: 'POST',
        url: '/my-entry/verify',
      };
      const res = mockRes();
      await myEntryVerify(req, res);
      // Must NOT reach the verified-edit path.
      expect(res.redirect).not.toHaveBeenCalledWith(
        expect.stringContaining('/my-entry/edit'),
      );
      expect(session.regenerate).not.toHaveBeenCalled();
    }
  });

  test('counts a failed verification toward the per-entryId guard', async () => {
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'real@b.com',
    });
    const req = {
      body: { entryId: '7', year: '2024', email: 'wrong@b.com' },
      session: {},
      method: 'POST',
      url: '/my-entry/verify',
    };
    const res = mockRes();
    await myEntryVerify(req, res);
    expect(reserveVerificationAttempt).toHaveBeenCalledWith({
      key: 'verify:7',
      windowMs: expect.any(Number),
      max: expect.any(Number),
    });
    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining('error=invalid'),
    );
  });

  test('uses the tightened 5-attempts / 15-minute verify window (#166 interim)', async () => {
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'real@b.com',
    });
    const req = {
      body: { entryId: '7', year: '2024', email: 'wrong@b.com' },
      session: {},
      method: 'POST',
      url: '/my-entry/verify',
    };
    const res = mockRes();
    await myEntryVerify(req, res);
    expect(reserveVerificationAttempt).toHaveBeenCalledWith({
      key: 'verify:7',
      windowMs: 15 * 60 * 1000,
      max: 5,
    });
  });

  test('matches email constant-time with trim + case folding (#166)', async () => {
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'User@Example.COM',
    });
    const session = {
      regenerate: vi.fn((cb) => cb(null)),
      save: vi.fn((cb) => cb(null)),
    };
    const req = {
      body: { entryId: '1', year: '2024', email: '  user@example.com  ' },
      session,
      method: 'POST',
      url: '/my-entry/verify',
    };
    const res = mockRes();
    await myEntryVerify(req, res);
    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining('/my-entry/edit'),
    );
    expect(reserveVerificationAttempt).toHaveBeenCalledTimes(1);
  });

  test.each(['wrong@b.com', 'real@b.com'])(
    'blocks exhausted verification before entry lookup, including %s',
    async (email) => {
      gameRepository.getEntryById.mockResolvedValue({
        id: '1',
        email: 'real@b.com',
      });
      reserveVerificationAttempt.mockResolvedValueOnce(true);
      const req = {
        body: { entryId: '1', year: '2024', email },
        session: {},
        method: 'POST',
        url: '/my-entry/verify',
      };
      const res = mockRes();
      await myEntryVerify(req, res);
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.set).toHaveBeenCalledWith('Retry-After', expect.any(String));
      expect(res.render).toHaveBeenCalledWith(
        'myEntryLookup',
        expect.objectContaining({ error: 'ratelimited' }),
      );
      expect(res.redirect).not.toHaveBeenCalled();
      expect(gameRepository.getEntryById).not.toHaveBeenCalled();
      expect(req.session.verifiedEntries).toBeUndefined();
    },
  );

  test('a successful verification consumes an attempt', async () => {
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'a@b.com',
    });
    const session = {
      regenerate: vi.fn((cb) => cb(null)),
      save: vi.fn((cb) => cb(null)),
    };
    const req = {
      body: { entryId: '1', year: '2024', email: 'a@b.com' },
      session,
      method: 'POST',
      url: '/my-entry/verify',
    };
    const res = mockRes();
    await myEntryVerify(req, res);
    expect(reserveVerificationAttempt).toHaveBeenCalledTimes(1);
    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining('/my-entry/edit'),
    );
  });

  test('email comparison is case-insensitive', async () => {
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'User@Example.COM',
    });
    const session = {
      regenerate: vi.fn((cb) => cb(null)),
      save: vi.fn((cb) => cb(null)),
    };
    const req = {
      body: { entryId: '1', year: '2024', email: 'user@example.com' },
      session,
      method: 'POST',
      url: '/my-entry/verify',
    };
    const res = mockRes();
    await myEntryVerify(req, res);
    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining('/my-entry/edit'),
    );
  });

  test('sets session flag and redirects to edit on valid email', async () => {
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'a@b.com',
    });
    const session = {
      regenerate: vi.fn((cb) => cb(null)),
      save: vi.fn((cb) => cb(null)),
    };
    const req = {
      body: { entryId: '1', year: '2024', email: 'a@b.com' },
      session,
      method: 'POST',
      url: '/my-entry/verify',
    };
    const res = mockRes();
    await myEntryVerify(req, res);
    expect(session.verifiedEntries?.['2024:1']).toBe(true);
    expect(session.regenerate).toHaveBeenCalled();
    expect(session.save).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining('/my-entry/edit'),
    );
    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining('entryId=1'),
    );
  });

  // -------------------------------------------------------------------------
  // #513 — a coexisting login must survive the regenerate()
  // -------------------------------------------------------------------------

  // server.js's session default; a fresh session falls back to this.
  const DEFAULT_MAX_AGE = 8 * 60 * 60 * 1000;

  // The plain `regenerate: cb => cb(null)` mocks above leave the old session
  // data in place, so a snapshot-and-restore assertion against them would pass
  // without the fix. express-session hands back an empty session with a fresh
  // cookie — simulate that, or these tests prove nothing.
  function makeRegeneratingSession(initial = {}) {
    const session = {
      ...initial,
      cookie: { maxAge: DEFAULT_MAX_AGE, ...(initial.cookie ?? {}) },
      save: vi.fn((cb) => cb(null)),
    };
    session.regenerate = vi.fn((cb) => {
      for (const key of Object.keys(session)) {
        if (key !== 'regenerate' && key !== 'save' && key !== 'cookie') {
          delete session[key];
        }
      }
      session.cookie = { maxAge: DEFAULT_MAX_AGE };
      cb(null);
    });
    return session;
  }

  async function verifyWith(session) {
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'a@b.com',
    });
    const req = {
      body: { entryId: '1', year: '2024', email: 'a@b.com' },
      session,
      method: 'POST',
      url: '/my-entry/verify',
    };
    const res = mockRes();
    await myEntryVerify(req, res);
    return res;
  }

  test('keeps an admin logged in across the verify regenerate (#513)', async () => {
    const session = makeRegeneratingSession({
      siteAdmin: true,
      adminEmail: 'admin@gmail.com',
      csrfToken: 'admin-token',
      cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }, // remember-me admin
    });
    await verifyWith(session);

    expect(session.regenerate).toHaveBeenCalled();
    expect(session.siteAdmin).toBe(true);
    expect(session.adminEmail).toBe('admin@gmail.com');
    // Rotating the token would turn the forced logout into a forced "invalid
    // CSRF token" on the admin's next submit — the same denial, relocated.
    expect(session.csrfToken).toBe('admin-token');
    // Restored exactly, not reset to the 8h default and not lengthened (#426).
    expect(session.cookie.maxAge).toBe(30 * 24 * 60 * 60 * 1000);
    // ...and the verification itself still took effect.
    expect(session.verifiedEntries?.['2024:1']).toBe(true);
  });

  test('keeps a signed-in participant logged in across the verify regenerate (#513)', async () => {
    const session = makeRegeneratingSession({
      userEmail: 'user@example.com',
      csrfToken: 'user-token',
      cookie: { maxAge: 14 * 24 * 60 * 60 * 1000 },
    });
    await verifyWith(session);

    expect(session.userEmail).toBe('user@example.com');
    expect(session.csrfToken).toBe('user-token');
    expect(session.cookie.maxAge).toBe(14 * 24 * 60 * 60 * 1000);
    expect(session.verifiedEntries?.['2024:1']).toBe(true);
  });

  test('preserves both an admin and a coexisting participant login', async () => {
    const session = makeRegeneratingSession({
      siteAdmin: true,
      adminEmail: 'admin@gmail.com',
      userEmail: 'user@example.com',
      csrfToken: 'shared-token',
      cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 },
    });
    await verifyWith(session);

    expect(session.siteAdmin).toBe(true);
    expect(session.adminEmail).toBe('admin@gmail.com');
    expect(session.userEmail).toBe('user@example.com');
    expect(session.csrfToken).toBe('shared-token');
    expect(session.cookie.maxAge).toBe(30 * 24 * 60 * 60 * 1000);
  });

  test('an identity with no prior CSRF token restores no token (guard skips, does not throw)', async () => {
    const session = makeRegeneratingSession({
      userEmail: 'user@example.com',
      csrfToken: undefined,
      cookie: { maxAge: 14 * 24 * 60 * 60 * 1000 },
    });
    await verifyWith(session);

    expect(session.userEmail).toBe('user@example.com');
    expect(session.csrfToken).toBeUndefined();
  });

  test('an identity with no prior cookie maxAge keeps the fresh session lifetime', async () => {
    const session = makeRegeneratingSession({
      userEmail: 'user@example.com',
      csrfToken: 'user-token',
      cookie: { maxAge: undefined },
    });
    await verifyWith(session);

    expect(session.userEmail).toBe('user@example.com');
    expect(session.cookie.maxAge).toBe(DEFAULT_MAX_AGE);
  });

  test('an anonymous verifier gains no admin or user identity, and keeps the fresh session lifetime', async () => {
    const session = makeRegeneratingSession();
    await verifyWith(session);

    expect(session.siteAdmin).toBeUndefined();
    expect(session.adminEmail).toBeUndefined();
    expect(session.userEmail).toBeUndefined();
    expect(session.csrfToken).toBeUndefined();
    expect(session.cookie.maxAge).toBe(DEFAULT_MAX_AGE);
    expect(session.verifiedEntries?.['2024:1']).toBe(true);
  });

  test('a prior verifiedEntries grant does not survive the regenerate (only logins are carried)', async () => {
    // Session fixation is what regenerate() is here to prevent; carrying the
    // whole session across would defeat it. Only the identity fields are
    // restored — everything else, including older entry grants, is dropped.
    const session = makeRegeneratingSession({
      verifiedEntries: { '2023:99': true },
    });
    await verifyWith(session);

    expect(session.verifiedEntries).toEqual({ '2024:1': true });
  });
});

// ---------------------------------------------------------------------------
// myEntryView
// ---------------------------------------------------------------------------

describe('myEntryView', () => {
  beforeEach(() => {
    isRegistrationOpen.mockReturnValue(true);
    getGroupRegistrationData.mockResolvedValue({
      teamData: [],
      gameData: [],
      regions: [{ regionName: 'East' }],
    });
  });

  test('returns 403 when registration is closed', async () => {
    isRegistrationOpen.mockReturnValue(false);
    const req = {
      query: { entryId: '1', year: '2024' },
      session: { verifiedEntries: { '2024:1': true } },
      method: 'GET',
      url: '/my-entry/edit',
    };
    const res = mockRes();
    await myEntryView(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 400 when entryId or year are missing', async () => {
    const req = {
      query: {},
      session: {},
      method: 'GET',
      url: '/my-entry/edit',
    };
    const res = mockRes();
    await myEntryView(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('redirects to /my-entry when session is missing', async () => {
    const req = {
      query: { entryId: '1', year: '2024' },
      session: {},
      method: 'GET',
      url: '/my-entry/edit',
    };
    const res = mockRes();
    await myEntryView(req, res);
    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining('/my-entry'),
    );
    expect(res.render).not.toHaveBeenCalled();
  });

  test('redirects to /my-entry when entryId not in session', async () => {
    const req = {
      query: { entryId: '1', year: '2024' },
      session: { verifiedEntries: { 99: true } },
      method: 'GET',
      url: '/my-entry/edit',
    };
    const res = mockRes();
    await myEntryView(req, res);
    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining('/my-entry'),
    );
    expect(res.render).not.toHaveBeenCalled();
  });

  test('redirects to error when entry is not found', async () => {
    gameRepository.getEntryById.mockResolvedValue(null);
    const req = {
      query: { entryId: '99', year: '2024' },
      session: { verifiedEntries: { '2024:99': true } },
      method: 'GET',
      url: '/my-entry/edit',
    };
    const res = mockRes();
    await myEntryView(req, res);
    expect(res.redirect).toHaveBeenCalledWith('/my-entry?error=notfound');
  });

  test('redirects to error when the verified entry has been soft-deleted (#310)', async () => {
    gameRepository.getEntryById.mockResolvedValue({
      id: 1,
      picks: [],
      groups: ['Family'],
      deletedAt: '2024-03-01T00:00:00.000Z',
    });
    const req = {
      query: { entryId: '1', year: '2024' },
      session: { verifiedEntries: { '2024:1': true } },
      method: 'GET',
      url: '/my-entry/edit',
    };
    const res = mockRes();
    await myEntryView(req, res);
    expect(res.redirect).toHaveBeenCalledWith('/my-entry?error=notfound');
    expect(res.render).not.toHaveBeenCalled();
  });

  test('renders myEditEntry when session is valid', async () => {
    gameRepository.getEntryById.mockResolvedValue({
      id: 1,
      picks: [],
      groups: ['Family'],
    });
    const req = {
      query: { entryId: '1', year: '2024' },
      session: { verifiedEntries: { '2024:1': true } },
      method: 'GET',
      url: '/my-entry/edit',
    };
    const res = mockRes();
    await myEntryView(req, res);
    expect(res.render).toHaveBeenCalledWith(
      'myEditEntry',
      expect.objectContaining({ regions: ['East'] }),
    );
  });

  test('returns 400 for a malformed entryId without querying the repository (#335)', async () => {
    const req = {
      query: { entryId: 'x/schoolRecords/y', year: '2024' },
      session: { verifiedEntries: {} },
      method: 'GET',
      url: '/my-entry/edit',
    };
    const res = mockRes();
    await myEntryView(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(gameRepository.getEntryById).not.toHaveBeenCalled();
  });

  test('returns 403 when year mismatches thisYear even though registration is open (#367)', async () => {
    isRegistrationOpen.mockReturnValue(true);
    const req = {
      query: { entryId: '1', year: '2025' },
      session: { verifiedEntries: { '2025:1': true } },
      method: 'GET',
      url: '/my-entry/edit',
    };
    const res = mockRes();
    await myEntryView(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.render).toHaveBeenCalledWith('myEntryClosed');
    expect(gameRepository.getEntryById).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// myEntryUpdate
// ---------------------------------------------------------------------------

// applyEntryUpdate requires exactly 10 unique picks, mirroring entryVerify.

describe('myEntryUpdate', () => {
  const validBody = {
    entryId: '1',
    email: 'a@b.com',
    year: '2024',
    team: 'Dukes',
    name: 'Alex',
    ...tenPickSelections,
    groups: 'Family',
    maxPoints: '0',
  };

  beforeEach(() => {
    getGroupRegistrationData.mockResolvedValue({
      teamData: tenPickTeamData,
      gameData: [],
      regions: [{ regionName: 'East' }],
    });
  });

  test('returns 403 when registration is closed', async () => {
    isRegistrationOpen.mockReturnValue(false);
    const req = {
      body: validBody,
      session: { verifiedEntries: { '2024:1': true } },
      method: 'POST',
      url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.render).toHaveBeenCalledWith('myEntryClosed');
  });

  test('redirects to /my-entry when session is missing', async () => {
    isRegistrationOpen.mockReturnValue(true);
    const req = {
      body: validBody,
      session: {},
      method: 'POST',
      url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(res.redirect).toHaveBeenCalledWith('/my-entry');
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  test('returns 400 for a malformed entryId without touching the repository (#335)', async () => {
    isRegistrationOpen.mockReturnValue(true);
    const req = {
      body: { ...validBody, entryId: 'x/schoolRecords/y' },
      session: { verifiedEntries: {} },
      method: 'POST',
      url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(gameRepository.getEntryById).not.toHaveBeenCalled();
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  test('calls updateEntry and renders confirm when session is valid', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'stored@b.com',
      groups: ['House'],
      hasPaid: true,
      paymentNote: 'stored note',
      payByCheck: true,
      emailSent: true,
    });
    gameRepository.updateEntry.mockResolvedValue();
    const req = {
      body: validBody,
      session: { verifiedEntries: { '2024:1': true } },
      method: 'POST',
      url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(gameRepository.updateEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '1',
        year: '2024',
        email: 'stored@b.com',
        groups: ['House'],
        hasPaid: true,
        paymentNote: 'stored note',
        payByCheck: true,
        emailSent: true,
        person: 'Alex',
        teamName: 'Dukes',
        picks: tenPickIds,
      }),
    );
    expect(res.render).toHaveBeenCalledWith(
      'confirm',
      expect.objectContaining({ name: 'Alex' }),
    );
  });

  test('ignores client maxPoints and persists server-recomputed possPoints (#159)', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'stored@b.com',
      groups: ['House'],
    });
    gameRepository.updateEntry.mockResolvedValue();
    calculateMaxPossiblePoints.mockResolvedValue(142);
    const req = {
      body: { ...validBody, maxPoints: '99999' },
      session: { verifiedEntries: { '2024:1': true } },
      method: 'POST',
      url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(calculateMaxPossiblePoints).toHaveBeenCalledWith(tenPickIds, '2024');
    expect(gameRepository.updateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ possPoints: 142 }),
    );
  });

  test('session for same entry in another year cannot update', async () => {
    isRegistrationOpen.mockReturnValue(true);
    const req = {
      body: { ...validBody, year: '2025' },
      session: { verifiedEntries: { '2024:1': true } },
      method: 'POST',
      url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.render).toHaveBeenCalledWith('myEntryClosed');
    expect(gameRepository.getEntryById).not.toHaveBeenCalled();
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  test('ignores groups and email from request body and preserves stored values', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'original@example.com',
      groups: ['OriginalGroup'],
      hasPaid: false,
      paymentNote: 'keep me',
      payByCheck: false,
      emailSent: false,
    });
    const req = {
      body: {
        ...validBody,
        email: 'attacker@example.com',
        groups: ['Family', 'Injected'],
      },
      session: { verifiedEntries: { '2024:1': true } },
      method: 'POST',
      url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(gameRepository.updateEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'original@example.com',
        groups: ['OriginalGroup'],
        paymentNote: 'keep me',
      }),
    );
    expect(res.render).toHaveBeenCalledWith(
      'confirm',
      expect.objectContaining({
        groupName: 'OriginalGroup',
        isPaymentCollectorGroup: false,
      }),
    );
  });

  test('redirects to notfound when verified entry no longer exists', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue(null);
    const req = {
      body: validBody,
      session: { verifiedEntries: { '2024:1': true } },
      method: 'POST',
      url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(res.redirect).toHaveBeenCalledWith('/my-entry?error=notfound');
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  test('redirects to notfound when the verified entry has been soft-deleted (#310)', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'stored@b.com',
      groups: ['House'],
      deletedAt: '2024-03-01T00:00:00.000Z',
    });
    const req = {
      body: validBody,
      session: { verifiedEntries: { '2024:1': true } },
      method: 'POST',
      url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(res.redirect).toHaveBeenCalledWith('/my-entry?error=notfound');
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  test('surfaces a team-validity error from the pick pipeline as a 400', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'original@example.com',
      groups: ['OriginalGroup'],
    });
    normalizeAndValidateEntryPicks.mockRejectedValue(
      new ValidationError('Pick 1 is not a valid team in this tournament.'),
    );
    const req = {
      body: validBody,
      session: { verifiedEntries: { '2024:1': true } },
      method: 'POST',
      url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Validation Error',
        message: expect.stringMatching(/Pick 1 is not a valid team/i),
      }),
    );
  });

  test('surfaces a duplicate-picks error from the pipeline as a 400', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'original@example.com',
      groups: ['OriginalGroup'],
    });
    normalizeAndValidateEntryPicks.mockRejectedValue(
      new ValidationError('Duplicate team picks are not allowed.'),
    );
    const req = {
      body: { ...validBody, teamSelect2: validBody.teamSelect1 },
      session: { verifiedEntries: { '2024:1': true } },
      method: 'POST',
      url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Validation Error',
        message: expect.stringMatching(/Duplicate team picks/i),
      }),
    );
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  test('surfaces a fewer-than-10-picks error from the pipeline as a 400', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'original@example.com',
      groups: ['OriginalGroup'],
    });
    normalizeAndValidateEntryPicks.mockRejectedValue(
      new ValidationError('Exactly 10 team picks are required.'),
    );
    const { teamSelect10, ...partialBody } = validBody;
    const req = {
      body: partialBody,
      session: { verifiedEntries: { '2024:1': true } },
      method: 'POST',
      url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Validation Error',
        message: expect.stringMatching(/Exactly 10 team picks/i),
      }),
    );
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  test('persists exactly the picks returned by the pipeline (FF winner lands in the entry)', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'stored@b.com',
      groups: ['House'],
    });
    gameRepository.updateEntry.mockResolvedValue();
    // The pipeline maps the stale FF pick (101) onto the live winner (999);
    // the controller stores exactly what the pipeline returns.
    normalizeAndValidateEntryPicks.mockImplementation(async (picks) =>
      picks.map((p) => (p === 101 ? 999 : p)),
    );

    const req = {
      body: validBody,
      session: { verifiedEntries: { '2024:1': true } },
      method: 'POST',
      url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(normalizeAndValidateEntryPicks).toHaveBeenCalledWith(
      tenPickIds,
      '2024',
      'House',
    );
    expect(gameRepository.updateEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        picks: [999, ...tenPickIds.slice(1)],
      }),
    );
    expect(res.render).toHaveBeenCalledWith('confirm', expect.anything());
  });

  test('renders confirm with the resolved pick names for the persisted picks, not the submitted names (#375)', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'stored@b.com',
      groups: ['House'],
    });
    gameRepository.updateEntry.mockResolvedValue();
    // Pipeline swaps the stale FF pick 101 → live winner 999.
    normalizeAndValidateEntryPicks.mockImplementation(async (picks) =>
      picks.map((p) => (p === 101 ? 999 : p)),
    );
    const resolvedNames = [
      'Winners Wildcats (East)',
      ...tenPickIds.slice(1).map((sID) => `Team ${sID}`),
    ];
    // Once-queue so the factory's passthrough default survives for other tests.
    resolveConfirmedPickNames.mockResolvedValueOnce(resolvedNames);

    const req = {
      body: validBody,
      session: { verifiedEntries: { '2024:1': true } },
      method: 'POST',
      url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);

    expect(resolveConfirmedPickNames).toHaveBeenCalledWith(
      tenPickIds,
      [999, ...tenPickIds.slice(1)],
      tenPickIds.map((sID) => `Team ${sID}`),
      '2024',
      'House',
    );
    expect(res.render).toHaveBeenCalledWith(
      'confirm',
      expect.objectContaining({
        picksNames: resolvedNames,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// applyEntryUpdate free-text validation (#548)
// ---------------------------------------------------------------------------

describe('myEntryUpdate name/team validation (#548)', () => {
  const validBody = {
    entryId: '1',
    year: '2024',
    team: 'Dukes',
    name: 'Alex',
    ...tenPickSelections,
    maxPoints: '0',
  };

  function reqFor(bodyOverrides) {
    return {
      body: { ...validBody, ...bodyOverrides },
      session: { verifiedEntries: { '2024:1': true } },
      method: 'POST',
      url: '/my-entry/update',
    };
  }

  beforeEach(() => {
    isRegistrationOpen.mockReturnValue(true);
    getGroupRegistrationData.mockResolvedValue({
      teamData: tenPickTeamData,
      gameData: [],
      regions: [{ regionName: 'East' }],
    });
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'stored@b.com',
      groups: ['House'],
    });
    gameRepository.updateEntry.mockResolvedValue();
  });

  // The status code is the visible half; `updateEntry` never being called is
  // the half that matters, because the pre-fix failure was Firestore's SDK
  // rejecting `undefined` *inside* the write and surfacing as a 500.
  test.each([
    ['team is missing', { team: undefined }, 'Team name is required.'],
    ['name is missing', { name: undefined }, 'Name is required.'],
    ['team is an empty string', { team: '   ' }, 'Team name is required.'],
    // Repeated form key: express.urlencoded({ extended: true }) parses
    // `team=a&team=b` to an array, which is truthy — the exact input the old
    // truthiness guard let through into `.trim()`.
    ['team is submitted twice', { team: ['a', 'b'] }, 'Team name is required.'],
    ['name is submitted twice', { name: ['a', 'b'] }, 'Name is required.'],
    [
      'team exceeds the 128-char cap',
      { team: 'x'.repeat(129) },
      'Team name must be at most 128 characters.',
    ],
    [
      'name exceeds the 128-char cap',
      { name: 'y'.repeat(129) },
      'Name must be at most 128 characters.',
    ],
  ])('returns 400 and never writes when %s', async (_label, override, msg) => {
    const res = mockRes();
    await myEntryUpdate(reqFor(override), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: msg }),
    );
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  // The check was deliberately hoisted above pick parsing and the service
  // calls: everything downstream burns Firestore reads, and a request that was
  // always going to be rejected shouldn't pay for them ($0 cost contract).
  test('rejects before the pick pipeline spends any Firestore reads', async () => {
    const res = mockRes();
    await myEntryUpdate(reqFor({ team: undefined }), res);
    expect(normalizeAndValidateEntryPicks).not.toHaveBeenCalled();
    expect(calculateMaxPossiblePoints).not.toHaveBeenCalled();
  });

  test('a 128-char value is accepted — the cap is inclusive', async () => {
    const res = mockRes();
    await myEntryUpdate(reqFor({ team: 'x'.repeat(128) }), res);
    expect(gameRepository.updateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ teamName: 'x'.repeat(128) }),
    );
  });

  test('persists the trimmed values', async () => {
    const res = mockRes();
    await myEntryUpdate(reqFor({ team: '  Dukes  ', name: ' Alex ' }), res);
    expect(gameRepository.updateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ teamName: 'Dukes', person: 'Alex' }),
    );
  });
});

// ---------------------------------------------------------------------------
// getUnsentEmails
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// myBrackets (Google-authenticated dashboard)
// ---------------------------------------------------------------------------

describe('myBrackets', () => {
  test("renders the dashboard with the signed-in user's entries", async () => {
    isRegistrationOpen.mockReturnValue(true);
    getEntriesForUser.mockResolvedValue([
      { id: 'a', year: 2024, editable: true },
    ]);
    const req = {
      session: { userEmail: 'player@gmail.com' },
      method: 'GET',
      url: '/my-brackets',
    };
    const res = mockRes();
    await myBrackets(req, res);
    expect(getEntriesForUser).toHaveBeenCalledWith('player@gmail.com');
    expect(res.render).toHaveBeenCalledWith(
      'myBrackets',
      expect.objectContaining({
        userEmail: 'player@gmail.com',
        entries: [{ id: 'a', year: 2024, editable: true }],
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// userEntryView (authorized by session email ownership)
// ---------------------------------------------------------------------------

describe('userEntryView', () => {
  beforeEach(() => {
    isRegistrationOpen.mockReturnValue(true);
    getGroupRegistrationData.mockResolvedValue({
      teamData: [],
      gameData: [],
      regions: [{ regionName: 'East' }],
    });
  });

  test('returns 403 when the edit window is closed', async () => {
    isRegistrationOpen.mockReturnValue(false);
    const req = {
      query: { entryId: '1', year: '2024' },
      session: { userEmail: 'u@g.com' },
      method: 'GET',
      url: '/my-brackets/edit',
    };
    const res = mockRes();
    await userEntryView(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.render).toHaveBeenCalledWith('myEntryClosed');
  });

  test('returns 403 for a past (non-current) year even while the window is open', async () => {
    const req = {
      query: { entryId: '1', year: '2023' },
      session: { userEmail: 'u@g.com' },
      method: 'GET',
      url: '/my-brackets/edit',
    };
    const res = mockRes();
    await userEntryView(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 403 when the entry is owned by a different email', async () => {
    gameRepository.getEntryById.mockResolvedValue({
      id: 1,
      email: 'someone-else@g.com',
      picks: [],
      groups: [],
    });
    const req = {
      query: { entryId: '1', year: '2024' },
      session: { userEmail: 'u@g.com' },
      method: 'GET',
      url: '/my-brackets/edit',
    };
    const res = mockRes();
    await userEntryView(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.render).toHaveBeenCalledWith('myEntryClosed');
  });

  test('redirects to /my-brackets when the entry does not exist', async () => {
    gameRepository.getEntryById.mockResolvedValue(null);
    const req = {
      query: { entryId: '99', year: '2024' },
      session: { userEmail: 'u@g.com' },
      method: 'GET',
      url: '/my-brackets/edit',
    };
    const res = mockRes();
    await userEntryView(req, res);
    expect(res.redirect).toHaveBeenCalledWith('/my-brackets');
  });

  test('redirects to /my-brackets when the owned entry has been soft-deleted (#310)', async () => {
    gameRepository.getEntryById.mockResolvedValue({
      id: 1,
      email: 'u@g.com',
      picks: [],
      groups: ['Fam'],
      deletedAt: '2024-03-01T00:00:00.000Z',
    });
    const req = {
      query: { entryId: '1', year: '2024' },
      session: { userEmail: 'u@g.com' },
      method: 'GET',
      url: '/my-brackets/edit',
    };
    const res = mockRes();
    await userEntryView(req, res);
    expect(res.redirect).toHaveBeenCalledWith('/my-brackets');
    expect(res.render).not.toHaveBeenCalled();
  });

  test('renders the editor (posting to /my-brackets/update) for an owned entry, case-insensitively', async () => {
    gameRepository.getEntryById.mockResolvedValue({
      id: 1,
      email: 'U@G.com',
      picks: [],
      groups: ['Fam'],
    });
    const req = {
      query: { entryId: '1', year: '2024' },
      session: { userEmail: 'u@g.com' },
      method: 'GET',
      url: '/my-brackets/edit',
    };
    const res = mockRes();
    await userEntryView(req, res);
    expect(res.render).toHaveBeenCalledWith(
      'myEditEntry',
      expect.objectContaining({ updateAction: '/my-brackets/update' }),
    );
  });

  test('returns 400 for a malformed entryId without querying the repository (#335)', async () => {
    const req = {
      query: { entryId: 'x/schoolRecords/y', year: '2024' },
      session: { userEmail: 'u@g.com' },
      method: 'GET',
      url: '/my-brackets/edit',
    };
    const res = mockRes();
    await userEntryView(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(gameRepository.getEntryById).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// userEntryUpdate (authorized by session email ownership)
// ---------------------------------------------------------------------------

describe('userEntryUpdate', () => {
  const validBody = {
    entryId: '1',
    year: '2024',
    team: 'Dukes',
    name: 'Alex',
    ...tenPickSelections,
    maxPoints: '0',
  };

  beforeEach(() => {
    getGroupRegistrationData.mockResolvedValue({
      teamData: tenPickTeamData,
      gameData: [],
      regions: [{ regionName: 'East' }],
    });
  });

  test('returns 403 and does not write when the edit window is closed', async () => {
    isRegistrationOpen.mockReturnValue(false);
    const req = {
      body: validBody,
      session: { userEmail: 'u@g.com' },
      method: 'POST',
      url: '/my-brackets/update',
    };
    const res = mockRes();
    await userEntryUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  test('returns 403 and does not write when the entry is owned by a different email', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'someone-else@g.com',
      groups: ['X'],
    });
    const req = {
      body: validBody,
      session: { userEmail: 'u@g.com' },
      method: 'POST',
      url: '/my-brackets/update',
    };
    const res = mockRes();
    await userEntryUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  test('redirects to /my-brackets when the entry does not exist', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue(null);
    const req = {
      body: validBody,
      session: { userEmail: 'u@g.com' },
      method: 'POST',
      url: '/my-brackets/update',
    };
    const res = mockRes();
    await userEntryUpdate(req, res);
    expect(res.redirect).toHaveBeenCalledWith('/my-brackets');
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  test('redirects to /my-brackets when the owned entry has been soft-deleted (#310)', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'u@g.com',
      groups: ['House'],
      deletedAt: '2024-03-01T00:00:00.000Z',
    });
    const req = {
      body: validBody,
      session: { userEmail: 'u@g.com' },
      method: 'POST',
      url: '/my-brackets/update',
    };
    const res = mockRes();
    await userEntryUpdate(req, res);
    expect(res.redirect).toHaveBeenCalledWith('/my-brackets');
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  test('persists and renders confirm for an owned entry, preserving stored email/groups', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'u@g.com',
      groups: ['House'],
      hasPaid: true,
    });
    gameRepository.updateEntry.mockResolvedValue();
    const req = {
      body: validBody,
      session: { userEmail: 'u@g.com' },
      method: 'POST',
      url: '/my-brackets/update',
    };
    const res = mockRes();
    await userEntryUpdate(req, res);
    expect(gameRepository.updateEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '1',
        year: '2024',
        email: 'u@g.com',
        groups: ['House'],
        picks: tenPickIds,
      }),
    );
    expect(res.render).toHaveBeenCalledWith('confirm', expect.anything());
  });

  test('surfaces a team-validity error from the pick pipeline as a 400', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'u@g.com',
      groups: ['House'],
    });
    normalizeAndValidateEntryPicks.mockRejectedValue(
      new ValidationError('Pick 1 is not a valid team in this tournament.'),
    );

    const req = {
      body: validBody,
      session: { userEmail: 'u@g.com' },
      method: 'POST',
      url: '/my-brackets/update',
    };
    const res = mockRes();
    await userEntryUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Validation Error',
        message: expect.stringMatching(/Pick 1 is not a valid team/i),
      }),
    );
  });

  test('returns 400 for a malformed entryId without touching the repository (#335)', async () => {
    isRegistrationOpen.mockReturnValue(true);
    const req = {
      body: { ...validBody, entryId: 'x/schoolRecords/y' },
      session: { userEmail: 'u@g.com' },
      method: 'POST',
      url: '/my-brackets/update',
    };
    const res = mockRes();
    await userEntryUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(gameRepository.getEntryById).not.toHaveBeenCalled();
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });
});
