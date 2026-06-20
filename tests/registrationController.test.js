import { entryConfirm, entryVerify } from '../src/controllers/registrationController.js';

vi.mock('../src/services/index.js', () => ({
  getGroupTeamDetails: vi.fn(),
  addTeamProgressforGroup: vi.fn(),
  verifyGroupExists: vi.fn(),
  getGroupRegistrationData: vi.fn(),
  normalizeFirstFourPicks: vi.fn(),
  validateEntryPicks: vi.fn(),
  normalizeAndValidateEntryPicks: vi.fn(),
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
    tournament: { paymentCollectorGroup: '', priorityGroups: [], defaultGroup: 'Default' },
    payments: { collectorName: '', collectorEmail: '', collectorPhone: '' },
  },
}));

import { verifyGroupExists, getGroupRegistrationData, normalizeFirstFourPicks, normalizeAndValidateEntryPicks, calculateMaxPossiblePoints } from '../src/services/index.js';
import { teamRepository, conferenceRepository } from '../src/repositories/index.js';
import { APP_CONFIG } from '../src/config/app.js';
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
  normalizeAndValidateEntryPicks.mockImplementation(async (picks) => [...picks]);
});

function makeConfirmSession(overrides = {}) {
  const payload = {
    name: 'Alex', team: 'Dukes', groupName: 'Family',
    picksNames: ['Duke', 'Kansas', 'UNC'],
    expiresAt: Date.now() + 600_000,
    ...overrides,
  };
  return {
    session: { pendingConfirmations: { 'abc123': payload } },
    payload,
  };
}

describe('entryConfirm', () => {
  test('renders confirm from session token', async () => {
    const { session, payload } = makeConfirmSession();
    const req = { query: { token: 'abc123' }, session, method: 'GET', url: '/entryConfirm' };
    const res = mockRes();
    await entryConfirm(req, res);
    expect(res.render).toHaveBeenCalledWith('confirm', expect.objectContaining({
      name: payload.name,
      team: payload.team,
      groupName: payload.groupName,
      picksNames: payload.picksNames,
    }));
  });

  test('isPaymentCollectorGroup is true when groupName matches the configured collector group', async () => {
    const { session } = makeConfirmSession({ groupName: 'Family' });
    const req = { query: { token: 'abc123' }, session, method: 'GET', url: '/entryConfirm' };
    const res = mockRes();
    await entryConfirm(req, res);
    expect(res.render.mock.calls[0][1].isPaymentCollectorGroup).toBe(true);
  });

  test('isPaymentCollectorGroup is false when groupName does not match', async () => {
    const { session } = makeConfirmSession({ groupName: 'House' });
    const req = { query: { token: 'abc123' }, session, method: 'GET', url: '/entryConfirm' };
    const res = mockRes();
    await entryConfirm(req, res);
    expect(res.render.mock.calls[0][1].isPaymentCollectorGroup).toBe(false);
  });

  test('returns 404 and renders confirmExpired when token is missing', async () => {
    const req = { query: {}, session: { pendingConfirmations: {} }, method: 'GET', url: '/entryConfirm' };
    const res = mockRes();
    await entryConfirm(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render).toHaveBeenCalledWith('confirmExpired');
  });

  test('returns 404 when token is not found in session', async () => {
    const req = { query: { token: 'badtoken' }, session: { pendingConfirmations: {} }, method: 'GET', url: '/entryConfirm' };
    const res = mockRes();
    await entryConfirm(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render).toHaveBeenCalledWith('confirmExpired');
  });

  test('returns 404 when token is expired', async () => {
    const { session } = makeConfirmSession({ expiresAt: Date.now() - 1 });
    const req = { query: { token: 'abc123' }, session, method: 'GET', url: '/entryConfirm' };
    const res = mockRes();
    await entryConfirm(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render).toHaveBeenCalledWith('confirmExpired');
  });

  test('deletes token from session after use', async () => {
    const { session } = makeConfirmSession();
    const req = { query: { token: 'abc123' }, session, method: 'GET', url: '/entryConfirm' };
    const res = mockRes();
    await entryConfirm(req, res);
    expect(session.pendingConfirmations['abc123']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// findEntry
// ---------------------------------------------------------------------------


describe('entryVerify pick parser', () => {
  // Builds a body with N valid picks plus any overrides supplied by the caller.
  function buildBody(overrides = {}) {
    const body = {
      name: 'Alex',
      team: 'Dukes',
      email: 'a@b.com',
      groupName: 'Test Group',
      year: '2024',
      maxPoints: '0',
    };
    for (let i = 1; i <= 10; i++) body[`teamSelect${i}`] = `${100 + i}, Team ${i}`;
    return { ...body, ...overrides };
  }

  function wireRegistrationMocks() {
    verifyGroupExists.mockResolvedValue('Test Group');
    getGroupRegistrationData.mockResolvedValue({
      teamData: Array.from({ length: 10 }, (_, i) => ({ sID: 101 + i, nameNick: `Team ${i + 1}`, seed: 1, regionName: 'East' })),
      gameData: [],
      regions: [{ regionName: 'East' }],
    });
    teamRepository.getAllSchools.mockResolvedValue([]);
    conferenceRepository.getAllConferences.mockResolvedValue([]);
    // #159: possPoints is now recomputed server-side; default the recompute to 0
    // so existing assertions remain stable. Individual tests override as needed.
    calculateMaxPossiblePoints.mockResolvedValue(0);
  }

  test('rejects a pick whose team name contains ", " (split yields >2 parts)', async () => {
    wireRegistrationMocks();
    // "St. Mary's, CA" splits to ["101", "St. Mary's", "CA"] — 3 parts
    const req = {
      body: buildBody({ teamSelect3: "101, St. Mary's, CA" }),
      method: 'POST',
      url: '/entryVerify',
    };
    const res = mockRes();
    await entryVerify(req, res);
    expect(res.render).toHaveBeenCalledWith(
      'registration',
      expect.objectContaining({ errorMessage: expect.stringMatching(/Pick 3.*malformed/i) })
    );
    // createNewEntry must not be called when input is rejected
    const { createNewEntry } = await import('../src/services/index.js');
    expect(createNewEntry).not.toHaveBeenCalled();
  });

  test('rejects a pick with a non-integer ID', async () => {
    wireRegistrationMocks();
    const req = {
      body: buildBody({ teamSelect5: 'notanumber, Duke' }),
      method: 'POST',
      url: '/entryVerify',
    };
    const res = mockRes();
    await entryVerify(req, res);
    expect(res.render).toHaveBeenCalledWith(
      'registration',
      expect.objectContaining({ errorMessage: expect.stringMatching(/Pick 5.*invalid team ID/i) })
    );
  });

  test('rejects a pick whose team name is empty', async () => {
    wireRegistrationMocks();
    const req = {
      body: buildBody({ teamSelect7: '107, ' }),
      method: 'POST',
      url: '/entryVerify',
    };
    const res = mockRes();
    await entryVerify(req, res);
    expect(res.render).toHaveBeenCalledWith(
      'registration',
      expect.objectContaining({ errorMessage: expect.stringMatching(/Pick 7.*invalid team name/i) })
    );
  });

  test('accepts 10 well-formed picks and proceeds to createNewEntry', async () => {
    wireRegistrationMocks();
    const { createNewEntry } = await import('../src/services/index.js');
    createNewEntry.mockResolvedValue();
    const req = {
      body: buildBody(),
      method: 'POST',
      url: '/entryVerify',
      session: { save: (cb) => cb() },
    };
    const res = mockRes();
    await entryVerify(req, res);
    expect(createNewEntry).toHaveBeenCalledWith(
      'a@b.com',
      'Dukes',
      'Alex',
      'Test Group',
      [101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
      2024,
      0
    );
    expect(res.redirect).toHaveBeenCalledWith(expect.stringMatching(/^\/entryConfirm\?token=/));
  });

  test('ignores client-supplied maxPoints and persists the server-recomputed possPoints (#159)', async () => {
    wireRegistrationMocks();
    // The client claims an inflated maxPoints; the server must recompute and
    // persist its own value, never the form value.
    calculateMaxPossiblePoints.mockResolvedValue(150);
    const { createNewEntry } = await import('../src/services/index.js');
    createNewEntry.mockResolvedValue();
    const req = {
      body: buildBody({ maxPoints: '99999' }),
      method: 'POST',
      url: '/entryVerify',
      session: { save: (cb) => cb() },
    };
    const res = mockRes();
    await entryVerify(req, res);
    // maxPoints recomputed from the normalized picks (not req.body.maxPoints).
    expect(calculateMaxPossiblePoints).toHaveBeenCalledWith(
      [101, 102, 103, 104, 105, 106, 107, 108, 109, 110], 2024
    );
    expect(createNewEntry).toHaveBeenCalledWith(
      'a@b.com', 'Dukes', 'Alex', 'Test Group',
      [101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
      2024, 150
    );
  });

  test('persists the picks returned by the pick pipeline (FF-normalized winner lands in the entry)', async () => {
    wireRegistrationMocks();
    // The service-layer pipeline maps the stale FF pick (101) onto the live
    // winner (999); the controller must persist exactly what the pipeline
    // returns. (FF-mapping correctness itself is covered in the viewService
    // test for normalizeAndValidateEntryPicks.)
    normalizeAndValidateEntryPicks.mockImplementation(async (picks) =>
      picks.map((p) => (p === 101 ? 999 : p))
    );
    const { createNewEntry } = await import('../src/services/index.js');
    createNewEntry.mockResolvedValue();
    const req = {
      body: buildBody(),
      method: 'POST',
      url: '/entryVerify',
      session: { save: (cb) => cb() },
    };
    const res = mockRes();
    await entryVerify(req, res);
    expect(normalizeAndValidateEntryPicks).toHaveBeenCalledWith(
      [101, 102, 103, 104, 105, 106, 107, 108, 109, 110], 2024, 'Test Group'
    );
    expect(createNewEntry).toHaveBeenCalledWith(
      'a@b.com', 'Dukes', 'Alex', 'Test Group',
      [999, 102, 103, 104, 105, 106, 107, 108, 109, 110],
      2024, 0
    );
  });

  test('re-renders with the pipeline error and skips createNewEntry when picks are rejected', async () => {
    wireRegistrationMocks();
    // The pipeline rejects the submission (e.g. two FF teams of one game
    // collapsing to a duplicate); the controller surfaces the message on the
    // registration page and never writes the entry.
    normalizeAndValidateEntryPicks.mockRejectedValue(
      new ValidationError('Duplicate team picks are not allowed.')
    );
    const { createNewEntry } = await import('../src/services/index.js');
    const req = {
      body: buildBody(),
      method: 'POST',
      url: '/entryVerify',
      session: { save: (cb) => cb() },
    };
    const res = mockRes();
    await entryVerify(req, res);
    expect(res.render).toHaveBeenCalledWith(
      'registration',
      expect.objectContaining({ errorMessage: expect.stringMatching(/Duplicate team picks/i) })
    );
    expect(createNewEntry).not.toHaveBeenCalled();
  });

  // C7 regression: session save must happen BEFORE createNewEntry so a save
  // failure can't leave a successfully-written Firestore entry without a
  // confirmation token, which would silently produce duplicates on retry.
  test('writes pendingConfirmations + session.save BEFORE createNewEntry (C7 regression)', async () => {
    wireRegistrationMocks();
    const { createNewEntry } = await import('../src/services/index.js');
    const callOrder = [];
    createNewEntry.mockImplementation(async () => {
      callOrder.push('createNewEntry');
    });
    const saveSpy = vi.fn((cb) => {
      callOrder.push('session.save');
      cb();
    });
    const req = {
      body: buildBody(),
      method: 'POST',
      url: '/entryVerify',
      session: { save: saveSpy },
    };
    const res = mockRes();
    await entryVerify(req, res);
    // session.save must precede the DB write
    expect(callOrder).toEqual(['session.save', 'createNewEntry']);
    // The pending payload must be persisted on the session before save fires
    expect(req.session.pendingConfirmations).toBeDefined();
    const tokens = Object.keys(req.session.pendingConfirmations);
    expect(tokens).toHaveLength(1);
    expect(req.session.pendingConfirmations[tokens[0]]).toMatchObject({
      name: 'Alex',
      team: 'Dukes',
      groupName: 'Test Group',
    });
  });

  test('re-renders with a team-validity error from the pipeline and skips createNewEntry', async () => {
    wireRegistrationMocks();
    // The pipeline validates team membership; a pick outside the tournament
    // surfaces as a ValidationError the controller renders back to the form.
    normalizeAndValidateEntryPicks.mockRejectedValue(
      new ValidationError('Pick 5 is not a valid team in this tournament.')
    );
    const req = {
      body: buildBody({ teamSelect5: '999, Fake Team' }),
      method: 'POST',
      url: '/entryVerify',
    };
    const res = mockRes();
    await entryVerify(req, res);
    expect(res.render).toHaveBeenCalledWith(
      'registration',
      expect.objectContaining({ errorMessage: expect.stringMatching(/Pick 5 is not a valid team/i) })
    );
    const { createNewEntry } = await import('../src/services/index.js');
    expect(createNewEntry).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// addGroup
// ---------------------------------------------------------------------------

