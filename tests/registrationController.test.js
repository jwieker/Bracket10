import {
  entryConfirm,
  entryVerify,
  groupVerifyfornewEntry,
} from '../src/controllers/registrationController.js';

vi.mock('../src/services/index.js', () => ({
  getGroupTeamDetails: vi.fn(),
  addTeamProgressforGroup: vi.fn(),
  verifyGroupExists: vi.fn(),
  getGroupRegistrationData: vi.fn(),
  normalizeFirstFourPicks: vi.fn(),
  validateEntryPicks: vi.fn(),
  normalizeAndValidateEntryPicks: vi.fn(),
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

import {
  verifyGroupExists,
  getGroupRegistrationData,
  normalizeFirstFourPicks,
  normalizeAndValidateEntryPicks,
  resolveConfirmedPickNames,
  calculateMaxPossiblePoints,
} from '../src/services/index.js';
import {
  teamRepository,
  conferenceRepository,
} from '../src/repositories/index.js';
import { APP_CONFIG, isRegistrationOpen } from '../src/config/app.js';
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
  // vi.clearAllMocks() doesn't undo a mockReturnValue() override from a prior
  // test, so reset this here (mirrors selfServiceController.test.js) — the
  // registration-window-guard tests below flip it to false and every other
  // test in this file assumes the window is open.
  isRegistrationOpen.mockReturnValue(true);
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

// Real tokens are randomBytes(16).toString('hex') — 32 hex chars (#511).
const VALID_TOKEN = '0123456789abcdef0123456789abcdef';

function makeConfirmSession(overrides = {}) {
  const payload = {
    name: 'Alex',
    team: 'Dukes',
    groupName: 'Family',
    picksNames: ['Duke', 'Kansas', 'UNC'],
    expiresAt: Date.now() + 600_000,
    ...overrides,
  };
  return {
    session: { pendingConfirmations: { [VALID_TOKEN]: payload } },
    payload,
  };
}

describe('entryConfirm', () => {
  test('renders confirm from session token', async () => {
    const { session, payload } = makeConfirmSession();
    const req = {
      query: { token: VALID_TOKEN },
      session,
      method: 'GET',
      url: '/entryConfirm',
    };
    const res = mockRes();
    await entryConfirm(req, res);
    expect(res.render).toHaveBeenCalledWith(
      'confirm',
      expect.objectContaining({
        name: payload.name,
        team: payload.team,
        groupName: payload.groupName,
        picksNames: payload.picksNames,
      }),
    );
  });

  test('isPaymentCollectorGroup is true when groupName matches the configured collector group', async () => {
    const { session } = makeConfirmSession({ groupName: 'Family' });
    const req = {
      query: { token: VALID_TOKEN },
      session,
      method: 'GET',
      url: '/entryConfirm',
    };
    const res = mockRes();
    await entryConfirm(req, res);
    expect(res.render.mock.calls[0][1].isPaymentCollectorGroup).toBe(true);
  });

  test('isPaymentCollectorGroup is false when groupName does not match', async () => {
    const { session } = makeConfirmSession({ groupName: 'House' });
    const req = {
      query: { token: VALID_TOKEN },
      session,
      method: 'GET',
      url: '/entryConfirm',
    };
    const res = mockRes();
    await entryConfirm(req, res);
    expect(res.render.mock.calls[0][1].isPaymentCollectorGroup).toBe(false);
  });

  test('returns 404 and renders confirmExpired when token is missing', async () => {
    const req = {
      query: {},
      session: { pendingConfirmations: {} },
      method: 'GET',
      url: '/entryConfirm',
    };
    const res = mockRes();
    await entryConfirm(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render).toHaveBeenCalledWith('confirmExpired');
  });

  test('returns 404 when token is not found in session', async () => {
    const req = {
      query: { token: 'ffffffffffffffffffffffffffffffff' },
      session: { pendingConfirmations: {} },
      method: 'GET',
      url: '/entryConfirm',
    };
    const res = mockRes();
    await entryConfirm(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render).toHaveBeenCalledWith('confirmExpired');
  });

  test('returns 404 when token is expired', async () => {
    const { session } = makeConfirmSession({ expiresAt: Date.now() - 1 });
    const req = {
      query: { token: VALID_TOKEN },
      session,
      method: 'GET',
      url: '/entryConfirm',
    };
    const res = mockRes();
    await entryConfirm(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render).toHaveBeenCalledWith('confirmExpired');
  });

  test('deletes token from session after use', async () => {
    const { session } = makeConfirmSession();
    const req = {
      query: { token: VALID_TOKEN },
      session,
      method: 'GET',
      url: '/entryConfirm',
    };
    const res = mockRes();
    await entryConfirm(req, res);
    expect(session.pendingConfirmations[VALID_TOKEN]).toBeUndefined();
  });

  // #511: these values resolve to inherited Object.prototype members when used
  // as a raw object key. Both defeated the old guard (truthy payload with an
  // undefined expiresAt) and reached res.render, where confirm.ejs threw on
  // picksNames.length and turned the intended 404 into a 500.
  test.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'returns 404 for the prototype-key token %s instead of 500ing',
    async (token) => {
      const { session } = makeConfirmSession();
      const req = {
        query: { token },
        session,
        method: 'GET',
        url: '/entryConfirm',
      };
      const res = mockRes();
      await entryConfirm(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.render).toHaveBeenCalledWith('confirmExpired');
      expect(res.render).not.toHaveBeenCalledWith('confirm', expect.anything());
      expect(session.pendingConfirmations[VALID_TOKEN]).toBeDefined();
    },
  );

  test('returns 404 when the token is not a string (?token=a&token=b yields an array)', async () => {
    const { session } = makeConfirmSession();
    const req = {
      query: { token: [VALID_TOKEN, VALID_TOKEN] },
      session,
      method: 'GET',
      url: '/entryConfirm',
    };
    const res = mockRes();
    await entryConfirm(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render).toHaveBeenCalledWith('confirmExpired');
  });

  test.each([
    ['0123456789abcdef0123456789abcde', '31 chars'],
    ['0123456789abcdef0123456789abcdef0', '33 chars'],
    ['zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', 'non-hex'],
  ])('returns 404 for a malformed token (%s)', async (token) => {
    const { session } = makeConfirmSession();
    const req = {
      query: { token },
      session,
      method: 'GET',
      url: '/entryConfirm',
    };
    const res = mockRes();
    await entryConfirm(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render).toHaveBeenCalledWith('confirmExpired');
  });
});

// ---------------------------------------------------------------------------
// Registration-window guard (#334)
// ---------------------------------------------------------------------------

describe('registration window guard', () => {
  test('entryVerify returns 403 and never creates an entry once registration is closed', async () => {
    isRegistrationOpen.mockReturnValue(false);
    const { createNewEntry } = await import('../src/services/index.js');
    const req = {
      body: {
        name: 'Alex',
        team: 'Dukes',
        email: 'a@b.com',
        groupName: 'Test Group',
        year: '2024',
      },
      method: 'POST',
      url: '/entryVerify',
    };
    const res = mockRes();
    await entryVerify(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.render).toHaveBeenCalledWith('myEntryClosed');
    expect(createNewEntry).not.toHaveBeenCalled();
  });

  test('groupVerifyfornewEntry returns 403 once registration is closed, without looking up the group', async () => {
    isRegistrationOpen.mockReturnValue(false);
    const req = {
      body: { game: 'Test Group' },
      method: 'POST',
      url: '/newEntry',
    };
    const res = mockRes();
    await groupVerifyfornewEntry(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.render).toHaveBeenCalledWith('myEntryClosed');
    expect(verifyGroupExists).not.toHaveBeenCalled();
  });

  // #589: this route had no guard on `game` at all, so an omitted field sent
  // `undefined` — and a repeated one an array — into findGroupByName, where
  // `name.toLowerCase()` threw and controllerWrapper answered a browser form
  // POST with a 500 JSON body. The redirect (not a 400) is the same choice
  // gameView makes for the same field, for the same reason: it's a form post.
  test.each([
    ['omitted', undefined],
    ['an array', ['a', 'b']],
    ['whitespace only', '   '],
  ])(
    'groupVerifyfornewEntry redirects home when game is %s',
    async (_label, game) => {
      const req = {
        body: { game, from: '//evil.example' },
        query: { from: 'https://evil.example' },
        method: 'POST',
        url: '/newEntry',
      };
      const res = mockRes();
      await groupVerifyfornewEntry(req, res);

      expect(res.redirect).toHaveBeenCalledWith('/?createError=true');
      expect(res.status).not.toHaveBeenCalled();
      expect(verifyGroupExists).not.toHaveBeenCalled();
    },
  );
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
    for (let i = 1; i <= 10; i++)
      body[`teamSelect${i}`] = `${100 + i}, Team ${i}`;
    return { ...body, ...overrides };
  }

  function wireRegistrationMocks() {
    verifyGroupExists.mockResolvedValue('Test Group');
    getGroupRegistrationData.mockResolvedValue({
      teamData: Array.from({ length: 10 }, (_, i) => ({
        sID: 101 + i,
        nameNick: `Team ${i + 1}`,
        seed: 1,
        regionName: 'East',
      })),
      gameData: [],
      regions: [{ regionName: 'East' }],
    });
    teamRepository.getAllSchools.mockResolvedValue([]);
    conferenceRepository.getAllConferences.mockResolvedValue([]);
    // #159: possPoints is now recomputed server-side; default the recompute to 0
    // so existing assertions remain stable. Individual tests override as needed.
    calculateMaxPossiblePoints.mockResolvedValue(0);
  }

  test('accepts a pick whose team name contains ", " and preserves the name (split on first separator only)', async () => {
    // #296 regression: the old split(", ") + length===2 check rejected a
    // legitimate name like "St. Mary's, CA" as malformed. The id is always
    // numeric, so we split on the FIRST ", " and the rest is the name.
    // Validation is by id only (normalizeAndValidateEntryPicks ignores names),
    // so id 103 flows straight through to createNewEntry.
    wireRegistrationMocks();
    const { createNewEntry } = await import('../src/services/index.js');
    createNewEntry.mockResolvedValue();
    const session = { save: (cb) => cb() };
    const req = {
      body: buildBody({ teamSelect3: "103, St. Mary's, CA" }),
      method: 'POST',
      url: '/entryVerify',
      session,
    };
    const res = mockRes();
    await entryVerify(req, res);
    // Not rejected: no malformed render, picks reach the service id-intact.
    expect(res.render).not.toHaveBeenCalledWith(
      'registration',
      expect.objectContaining({
        errorMessage: expect.stringMatching(/malformed/i),
      }),
    );
    expect(createNewEntry).toHaveBeenCalledWith(
      'a@b.com',
      'Dukes',
      'Alex',
      'Test Group',
      [101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
      2024,
      0,
    );
    // Positive gate on the full success path: a crash/early-return after
    // createNewEntry would pass the negative render assertion but fail here.
    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringMatching(/^\/entryConfirm\?token=/),
    );
    // The id is by design identical to buildBody's default for slot 3, so the
    // ids assertion alone can't prove the parser didn't corrupt the name.
    // Assert the comma-containing name survived intact — it's staged by name
    // (not id) into the pending-confirmation payload, which is the only place
    // the parsed name is observable from the controller.
    const [pending] = Object.values(session.pendingConfirmations);
    expect(pending.picksNames[2]).toBe("St. Mary's, CA");
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
      expect.objectContaining({
        errorMessage: expect.stringMatching(/Pick 5.*invalid team ID/i),
      }),
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
      expect.objectContaining({
        errorMessage: expect.stringMatching(/Pick 7.*invalid team name/i),
      }),
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
      0,
    );
    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringMatching(/^\/entryConfirm\?token=/),
    );
  });

  test('redirects to the generic create-error page and skips createNewEntry when groupName does not resolve to a real group (#429)', async () => {
    // A nonexistent or case-variant group name must not silently create a ghost entry.
    verifyGroupExists.mockResolvedValue(null);
    const { createNewEntry } = await import('../src/services/index.js');
    const req = {
      body: buildBody({ groupName: 'NoSuchGroup' }),
      method: 'POST',
      url: '/entryVerify',
    };
    const res = mockRes();
    await entryVerify(req, res);
    expect(createNewEntry).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/?createError=true');
  });

  test('persists the canonical group name (not the submitted casing) on the written entry (#429)', async () => {
    // verifyGroupExists resolves case-insensitively to the canonical stored
    // name; the entry must be written under that name, not whatever casing
    // the client submitted, or the entry becomes invisible to its group
    // (every group read is byte-exact).
    wireRegistrationMocks();
    const { createNewEntry } = await import('../src/services/index.js');
    createNewEntry.mockResolvedValue();
    const req = {
      body: buildBody({ groupName: 'test group' }),
      method: 'POST',
      url: '/entryVerify',
      session: { save: (cb) => cb() },
    };
    const res = mockRes();
    await entryVerify(req, res);
    expect(verifyGroupExists).toHaveBeenCalledWith('test group');
    expect(normalizeAndValidateEntryPicks).toHaveBeenCalledWith(
      [101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
      2024,
      'Test Group',
    );
    expect(createNewEntry).toHaveBeenCalledWith(
      'a@b.com',
      'Dukes',
      'Alex',
      'Test Group',
      [101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
      2024,
      0,
    );
  });

  test('ignores client-supplied year and always creates the entry for thisYear (#391)', async () => {
    // A forged year param must not let an entry be written into an archived
    // tournament while registration for the current year is open.
    wireRegistrationMocks();
    const { createNewEntry } = await import('../src/services/index.js');
    createNewEntry.mockResolvedValue();
    const req = {
      body: buildBody({ year: '2019' }),
      method: 'POST',
      url: '/entryVerify',
      session: { save: (cb) => cb() },
    };
    const res = mockRes();
    await entryVerify(req, res);
    expect(normalizeAndValidateEntryPicks).toHaveBeenCalledWith(
      [101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
      2024,
      'Test Group',
    );
    expect(calculateMaxPossiblePoints).toHaveBeenCalledWith(
      [101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
      2024,
    );
    expect(createNewEntry).toHaveBeenCalledWith(
      'a@b.com',
      'Dukes',
      'Alex',
      'Test Group',
      [101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
      2024,
      0,
    );
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
      [101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
      2024,
    );
    expect(createNewEntry).toHaveBeenCalledWith(
      'a@b.com',
      'Dukes',
      'Alex',
      'Test Group',
      [101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
      2024,
      150,
    );
  });

  test('persists the picks returned by the pick pipeline (FF-normalized winner lands in the entry)', async () => {
    wireRegistrationMocks();
    // The service-layer pipeline maps the stale FF pick (101) onto the live
    // winner (999); the controller must persist exactly what the pipeline
    // returns. (FF-mapping correctness itself is covered in the viewService
    // test for normalizeAndValidateEntryPicks.)
    normalizeAndValidateEntryPicks.mockImplementation(async (picks) =>
      picks.map((p) => (p === 101 ? 999 : p)),
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
      [101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
      2024,
      'Test Group',
    );
    expect(createNewEntry).toHaveBeenCalledWith(
      'a@b.com',
      'Dukes',
      'Alex',
      'Test Group',
      [999, 102, 103, 104, 105, 106, 107, 108, 109, 110],
      2024,
      0,
    );
  });

  test('stages the resolved pick names (not the submitted ones) in the confirmation payload (#375)', async () => {
    wireRegistrationMocks();
    // Pipeline swaps stale FF pick 101 → live winner 999; the confirmation
    // payload must carry the persisted pick's display name.
    normalizeAndValidateEntryPicks.mockImplementation(async (picks) =>
      picks.map((p) => (p === 101 ? 999 : p)),
    );
    const submittedNames = Array.from(
      { length: 10 },
      (_, i) => `Team ${i + 1}`,
    );
    const resolvedNames = [
      'Winners Wildcats (East)',
      ...submittedNames.slice(1),
    ];
    // Once-queue so the factory's passthrough default survives for other tests.
    resolveConfirmedPickNames.mockResolvedValueOnce(resolvedNames);
    const { createNewEntry } = await import('../src/services/index.js');
    createNewEntry.mockResolvedValue();

    const session = { save: (cb) => cb() };
    const req = {
      body: buildBody(),
      method: 'POST',
      url: '/entryVerify',
      session,
    };
    const res = mockRes();
    await entryVerify(req, res);

    expect(resolveConfirmedPickNames).toHaveBeenCalledWith(
      [101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
      [999, 102, 103, 104, 105, 106, 107, 108, 109, 110],
      submittedNames,
      2024,
      'Test Group',
    );
    const payload = Object.values(session.pendingConfirmations)[0];
    expect(payload.picksNames).toEqual(resolvedNames);
  });

  test('re-renders with the pipeline error and skips createNewEntry when picks are rejected', async () => {
    wireRegistrationMocks();
    // The pipeline rejects the submission (e.g. two FF teams of one game
    // collapsing to a duplicate); the controller surfaces the message on the
    // registration page and never writes the entry.
    normalizeAndValidateEntryPicks.mockRejectedValue(
      new ValidationError('Duplicate team picks are not allowed.'),
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
      expect.objectContaining({
        errorMessage: expect.stringMatching(/Duplicate team picks/i),
      }),
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

  // #592: entryConfirm only deletes a token on a successful confirmation, so
  // abandoned registrations used to accumulate in the session document with
  // nothing ever enforcing their expiresAt. entryVerify now sweeps on write.
  test('sweeps expired pendingConfirmations and keeps live ones (#592)', async () => {
    wireRegistrationMocks();
    const { createNewEntry } = await import('../src/services/index.js');
    createNewEntry.mockResolvedValue();
    const expiredToken = 'a'.repeat(32);
    const liveToken = 'b'.repeat(32);
    const livePayload = {
      name: 'Live',
      team: 'Live Team',
      groupName: 'Test Group',
      picksNames: ['Duke'],
      expiresAt: Date.now() + 600_000,
    };
    const session = {
      save: (cb) => cb(),
      pendingConfirmations: {
        [expiredToken]: {
          name: 'Stale',
          team: 'Stale Team',
          groupName: 'Test Group',
          picksNames: ['Kansas'],
          expiresAt: Date.now() - 1,
        },
        [liveToken]: livePayload,
      },
    };
    const req = {
      body: buildBody(),
      method: 'POST',
      url: '/entryVerify',
      session,
    };
    const res = mockRes();
    await entryVerify(req, res);

    expect(session.pendingConfirmations[expiredToken]).toBeUndefined();
    expect(session.pendingConfirmations[liveToken]).toEqual(livePayload);
    // The sweep must not eat the token this request just minted.
    const tokens = Object.keys(session.pendingConfirmations);
    expect(tokens).toHaveLength(2);
    const minted = tokens.find((t) => t !== liveToken);
    expect(session.pendingConfirmations[minted]).toMatchObject({
      name: 'Alex',
      team: 'Dukes',
    });
  });

  // A payload with no expiresAt can only be malformed or a pre-#511 leftover;
  // left in place it would never expire, so the sweep treats it as expired.
  test('sweeps a pendingConfirmation that has no expiresAt (#592)', async () => {
    wireRegistrationMocks();
    const { createNewEntry } = await import('../src/services/index.js');
    createNewEntry.mockResolvedValue();
    const undatedToken = 'c'.repeat(32);
    const session = {
      save: (cb) => cb(),
      pendingConfirmations: {
        [undatedToken]: { name: 'Undated', team: 'No TTL' },
      },
    };
    const req = {
      body: buildBody(),
      method: 'POST',
      url: '/entryVerify',
      session,
    };
    const res = mockRes();
    await entryVerify(req, res);

    expect(session.pendingConfirmations[undatedToken]).toBeUndefined();
    expect(Object.keys(session.pendingConfirmations)).toHaveLength(1);
  });

  test('re-renders with a team-validity error from the pipeline and skips createNewEntry', async () => {
    wireRegistrationMocks();
    // The pipeline validates team membership; a pick outside the tournament
    // surfaces as a ValidationError the controller renders back to the form.
    normalizeAndValidateEntryPicks.mockRejectedValue(
      new ValidationError('Pick 5 is not a valid team in this tournament.'),
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
      expect.objectContaining({
        errorMessage: expect.stringMatching(/Pick 5 is not a valid team/i),
      }),
    );
    const { createNewEntry } = await import('../src/services/index.js');
    expect(createNewEntry).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// entryVerify required-field validation (#549 / #548)
// ---------------------------------------------------------------------------

describe('entryVerify required-field validation', () => {
  function buildBody(overrides = {}) {
    const body = {
      name: 'Alex',
      team: 'Dukes',
      email: 'a@b.com',
      groupName: 'Test Group',
      year: '2024',
      maxPoints: '0',
    };
    for (let i = 1; i <= 10; i++)
      body[`teamSelect${i}`] = `${100 + i}, Team ${i}`;
    return { ...body, ...overrides };
  }

  beforeEach(async () => {
    verifyGroupExists.mockResolvedValue('Test Group');
    getGroupRegistrationData.mockResolvedValue({
      teamData: [],
      gameData: [],
      regions: [{ regionName: 'East' }],
    });
    teamRepository.getAllSchools.mockResolvedValue([]);
    conferenceRepository.getAllConferences.mockResolvedValue([]);
    calculateMaxPossiblePoints.mockResolvedValue(0);
    const { createNewEntry } = await import('../src/services/index.js');
    createNewEntry.mockResolvedValue();
  });

  function reqFor(overrides) {
    return {
      body: buildBody(overrides),
      method: 'POST',
      url: '/entryVerify',
      session: { save: (cb) => cb() },
    };
  }

  // Every case here re-renders the registration form with an inline message.
  // Asserting `res.status` was never called is the regression guard: before the
  // fix an array-valued field threw a TypeError out of `.trim()`, and
  // controllerWrapper answered this form POST with a 500 JSON body (#549).
  test.each([
    ['name is missing', { name: undefined }, 'Name is required.'],
    ['team is missing', { team: undefined }, 'Team name is required.'],
    ['email is missing', { email: undefined }, 'Email is required.'],
    ['name is submitted twice', { name: ['a', 'b'] }, 'Name is required.'],
    ['team is submitted twice', { team: ['a', 'b'] }, 'Team name is required.'],
    [
      'email is submitted twice',
      { email: ['a@b.com', 'c@d.com'] },
      'Email is required.',
    ],
    ['team is whitespace only', { team: '   ' }, 'Team name is required.'],
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
    // Email is capped at RFC 5321's 254 rather than 128 — it isn't the
    // publicly-rendered field the tighter cap protects.
    [
      'email exceeds the 254-char cap',
      { email: `${'z'.repeat(250)}@b.com` },
      'Email must be at most 254 characters.',
    ],
  ])('re-renders with an inline error when %s', async (_l, override, msg) => {
    const res = mockRes();
    await entryVerify(reqFor(override), res);
    expect(res.render).toHaveBeenCalledWith(
      'registration',
      expect.objectContaining({ errorMessage: msg }),
    );
    expect(res.status).not.toHaveBeenCalled();
    const { createNewEntry } = await import('../src/services/index.js');
    expect(createNewEntry).not.toHaveBeenCalled();
  });

  test('a 128-char team name is accepted — the cap is inclusive', async () => {
    const res = mockRes();
    await entryVerify(reqFor({ team: 'x'.repeat(128) }), res);
    const { createNewEntry } = await import('../src/services/index.js');
    expect(createNewEntry).toHaveBeenCalledWith(
      'a@b.com',
      'x'.repeat(128),
      'Alex',
      'Test Group',
      expect.any(Array),
      2024,
      0,
    );
  });

  test('persists the trimmed values', async () => {
    const res = mockRes();
    await entryVerify(
      reqFor({ name: '  Alex  ', team: ' Dukes ', email: ' a@b.com ' }),
      res,
    );
    const { createNewEntry } = await import('../src/services/index.js');
    expect(createNewEntry).toHaveBeenCalledWith(
      'a@b.com',
      'Dukes',
      'Alex',
      'Test Group',
      expect.any(Array),
      2024,
      0,
    );
  });

  // groupName has the same array hazard but a different response shape: it
  // throws, because reRenderWithError can't help when the group is what's
  // wrong (fetchRegistrationPageData would re-resolve the same bad value).
  test('a repeated groupName key is a 400, not a 500', async () => {
    const res = mockRes();
    await entryVerify(reqFor({ groupName: ['a', 'b'] }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Group name is required.' }),
    );
  });
});

// ---------------------------------------------------------------------------
// addGroup
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// fetchRegistrationPageData — shared-cache safety (#554)
// ---------------------------------------------------------------------------

describe('registration page conference enrichment', () => {
  test('derives conferenceName on a copy, leaving the shared cached team objects untouched', async () => {
    // cachedTeam stands in for a team document from the 300s
    // `tournamentDetails_` cache — the results page reads `conferenceName` off
    // these same objects to build its own conferenceStats, so a write here
    // would cross request and group boundaries.
    const cachedTeam = { sID: 101, nameNick: 'Duke', seed: 1 };
    // A combined First Four option, by contrast, is built by hand in
    // getGroupRegistrationData and is a fresh object with no denormalized
    // conferenceName — which is why the write is kept rather than dropped.
    const ffOption = {
      sID: 202,
      nameNick: 'A / B',
      isFirstFour: true,
      seed: 16,
    };

    verifyGroupExists.mockResolvedValue('Test Group');
    getGroupRegistrationData.mockResolvedValue({
      teamData: [cachedTeam, ffOption],
      gameData: [],
      regions: [],
    });
    teamRepository.getAllSchools.mockResolvedValue([
      { sid: 101, confID: 'acc' },
      { sid: 202, confID: 'bigten' },
    ]);
    conferenceRepository.getAllConferences.mockResolvedValue([
      { slug: 'acc', shortName: 'ACC' },
      { slug: 'bigten', shortName: 'B1G' },
    ]);

    const req = {
      body: { game: 'Test Group' },
      method: 'POST',
      url: '/newEntry',
    };
    const res = mockRes();
    await groupVerifyfornewEntry(req, res);

    expect(cachedTeam).not.toHaveProperty('conferenceName');
    expect(ffOption).not.toHaveProperty('conferenceName');

    // The rendered payload still carries the derived names, including for the
    // First Four option that has no conferenceName of its own.
    const rendered = res.render.mock.calls[0][1];
    expect(rendered.teamData.map((t) => t.conferenceName)).toEqual([
      'ACC',
      'B1G',
    ]);
    expect(rendered.conferenceStats).toEqual({
      ACC: { total: 1, picked: 0 },
      B1G: { total: 1, picked: 0 },
    });
  });
});
