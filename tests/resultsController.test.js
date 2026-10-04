import {
  calculateMaxPoints,
  getFullGrid,
  getFullGridCSV,
  gameView,
} from '../src/controllers/resultsController.js';
import { toCSVRow } from '../src/utils/csvUtils.js';

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
vi.mock('../src/config/app.js', () => ({
  thisYear: 2024,
  isRegistrationOpen: vi.fn(() => true),
  APP_CONFIG: {
    tournament: {
      paymentCollectorGroup: '',
      priorityGroups: [],
      defaultGroup: 'Default',
      // Must mirror the real config value: calculateMaxPoints compares
      // teamSIDs.length against it, and `length > undefined` is always false —
      // so omitting it here would make the cap silently untested.
      maxPicksPerEntry: 10,
    },
    payments: { collectorName: '', collectorEmail: '', collectorPhone: '' },
  },
}));

import {
  calculateMaxPossiblePoints,
  buildFullGridData,
  verifyGroupExists,
  buildGameViewData,
  getEntryIdsForUserInGroup,
} from '../src/services/index.js';
import { APP_CONFIG } from '../src/config/app.js';

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
  // Default: the group exists and is already canonical. Tests that care about
  // canonicalization or a missing group override this (#515).
  verifyGroupExists.mockImplementation(async (name) => name);
});

describe('calculateMaxPoints', () => {
  test('returns 400 when teamSIDs is missing', async () => {
    const req = { body: {}, method: 'POST', url: '/calculateMaxPoints' };
    const res = mockRes();
    await calculateMaxPoints(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when teamSIDs is not an array', async () => {
    const req = {
      body: { teamSIDs: 'not-an-array' },
      method: 'POST',
      url: '/calculateMaxPoints',
    };
    const res = mockRes();
    await calculateMaxPoints(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Validation Error' }),
    );
  });

  test('calls calculateMaxPossiblePoints and returns 200 with maxPoints', async () => {
    calculateMaxPossiblePoints.mockResolvedValue(150);
    const req = {
      body: { teamSIDs: [1, 2, 3], year: '2024' },
      method: 'POST',
      url: '/calculateMaxPoints',
    };
    const res = mockRes();
    await calculateMaxPoints(req, res);
    expect(calculateMaxPossiblePoints).toHaveBeenCalledWith([1, 2, 3], 2024);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: { maxPoints: 150 },
      }),
    );
  });

  test('passes undefined year when not provided', async () => {
    calculateMaxPossiblePoints.mockResolvedValue(99);
    const req = {
      body: { teamSIDs: [1] },
      method: 'POST',
      url: '/calculateMaxPoints',
    };
    const res = mockRes();
    await calculateMaxPoints(req, res);
    expect(calculateMaxPossiblePoints).toHaveBeenCalledWith([1], undefined);
  });

  test('returns 400 for invalid year', async () => {
    const req = {
      body: { teamSIDs: [1], year: 'abc' },
      method: 'POST',
      url: '/calculateMaxPoints',
    };
    const res = mockRes();
    await calculateMaxPoints(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Validation Error', field: 'year' }),
    );
  });

  test('rejects more than maxPicksPerEntry teamSIDs without reaching the points engine', async () => {
    const req = {
      body: { teamSIDs: Array.from({ length: 11 }, (_, i) => i + 1) },
      method: 'POST',
      url: '/calculateMaxPoints',
    };
    const res = mockRes();
    await calculateMaxPoints(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Validation Error', field: 'teamSIDs' }),
    );
    // The negative assertion is the point: the cap is an event-loop guard, so
    // rejecting *before* the synchronous per-pick bracket walk is the behavior
    // under test, not the status code.
    expect(calculateMaxPossiblePoints).not.toHaveBeenCalled();
  });

  test('still accepts a full 10-pick entry — the size both browser callers post', async () => {
    calculateMaxPossiblePoints.mockResolvedValue(120);
    const teamSIDs = Array.from({ length: 10 }, (_, i) => i + 1);
    const req = {
      body: { teamSIDs },
      method: 'POST',
      url: '/calculateMaxPoints',
    };
    const res = mockRes();
    await calculateMaxPoints(req, res);
    expect(calculateMaxPossiblePoints).toHaveBeenCalledWith(
      teamSIDs,
      undefined,
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ---------------------------------------------------------------------------
// entryConfirm
// ---------------------------------------------------------------------------

describe('toCSVRow formula injection neutralization', () => {
  test('cells beginning with a formula char are prefixed with a single quote', () => {
    expect(toCSVRow(['=HYPERLINK("http://evil")'])).toBe(
      '"\'=HYPERLINK(""http://evil"")"',
    );
    expect(toCSVRow(['+1+1'])).toBe("'+1+1");
    expect(toCSVRow(['@SUM(A1)'])).toBe("'@SUM(A1)");
    expect(toCSVRow(['-2'])).toBe("'-2");
    expect(toCSVRow(['\t=cmd'])).toBe("'\t=cmd");
  });

  test('benign values are untouched', () => {
    expect(toCSVRow(['House Pool'])).toBe('House Pool');
    expect(toCSVRow([42, '', null])).toBe('42,,');
  });

  test('quoting still applies after neutralization', () => {
    expect(toCSVRow(['=A1,B1'])).toBe('"\'=A1,B1"');
  });

  test('a negative number is emitted as text — conscious tradeoff, fails loudly if a signed column is added', () => {
    // FORMULA_LEAD includes leading "-" (OWASP set), so a negative numeric
    // cell becomes '-2 (text) in the export. Harmless today because every
    // numeric export column (Rank, Points, counts, pick indexes) is
    // non-negative. If this test starts mattering — i.e. a signed column is
    // added to getFullGridCSV — exempt actual numbers from neutralization
    // (e.g. only neutralize string-typed cells) rather than dropping "-"
    // from FORMULA_LEAD.
    expect(toCSVRow([-2])).toBe("'-2");
    expect(toCSVRow(['-2'])).toBe("'-2");
  });
});

// ---------------------------------------------------------------------------
// getFullGrid / getFullGridCSV — request validation (#479)
// ---------------------------------------------------------------------------

describe('full grid request validation', () => {
  test.each([
    ['missing gameName', { gameYear: '2024' }, 'gameName'],
    ['missing gameYear', { gameName: 'House' }, 'year'],
    ['non-numeric gameYear', { gameName: 'House', gameYear: 'abc' }, 'year'],
  ])('getFullGrid returns 400 on %s', async (_label, body, field) => {
    const req = { body, method: 'POST', url: '/getFullGrid' };
    const res = mockRes();
    await getFullGrid(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Validation Error', field }),
    );
    // The bad request must never reach the service — that trip is what used to
    // turn into an unhandled Firestore error and a generic 500.
    expect(buildFullGridData).not.toHaveBeenCalled();
  });

  test('getFullGridCSV returns 400 when gameName is missing', async () => {
    const req = {
      query: { gameYear: '2024' },
      method: 'GET',
      url: '/getFullGridCSV',
    };
    const res = { ...mockRes(), setHeader: vi.fn() };
    await getFullGridCSV(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(buildFullGridData).not.toHaveBeenCalled();
  });

  test('getFullGrid renders with a numeric gameYear on a valid request', async () => {
    buildFullGridData.mockResolvedValue({
      groupData: [],
      allTeamsWithPickCounts: [],
    });
    const req = {
      body: { gameName: 'House', gameYear: '2024' },
      method: 'POST',
      url: '/getFullGrid',
    };
    const res = mockRes();
    await getFullGrid(req, res);
    expect(buildFullGridData).toHaveBeenCalledWith('House', 2024);
    expect(res.render).toHaveBeenCalledWith(
      'fullGrid',
      expect.objectContaining({ groupName: 'House', gameYear: 2024 }),
    );
  });
});

// ---------------------------------------------------------------------------
// getFullGrid / getFullGridCSV — group canonicalization (#515)
//
// These paths used to pass the raw request string to buildFullGridData, so a
// case variant produced an empty grid that was indistinguishable from a group
// with no entries, and minted a separate fullGridData_ cache entry per casing.
// ---------------------------------------------------------------------------

describe('full grid group canonicalization', () => {
  test('getFullGrid resolves a case variant to the stored group name', async () => {
    verifyGroupExists.mockResolvedValue('House');
    buildFullGridData.mockResolvedValue({
      groupData: [],
      allTeamsWithPickCounts: [],
    });
    const req = {
      body: { gameName: 'house', gameYear: '2024' },
      method: 'POST',
      url: '/getFullGrid',
    };
    const res = mockRes();
    await getFullGrid(req, res);

    expect(verifyGroupExists).toHaveBeenCalledWith('house');
    // The read and the render both use the canonical name — not the raw input.
    expect(buildFullGridData).toHaveBeenCalledWith('House', 2024);
    expect(res.render).toHaveBeenCalledWith(
      'fullGrid',
      expect.objectContaining({ groupName: 'House' }),
    );
  });

  test('getFullGrid returns 400 for a group that does not exist', async () => {
    verifyGroupExists.mockResolvedValue(null);
    const req = {
      body: { gameName: 'NoSuchGroup', gameYear: '2024' },
      method: 'POST',
      url: '/getFullGrid',
    };
    const res = mockRes();
    await getFullGrid(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    // Distinct from the "missing gameName" 400 above: the caller did supply a
    // name, it just didn't resolve. Same status and field, different message —
    // asserted so the two guards can't silently collapse back into one.
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Group not found',
        field: 'gameName',
      }),
    );
    // An unknown group must not reach the service — that read is what used to
    // return empty data and render as a legitimately-empty grid.
    expect(buildFullGridData).not.toHaveBeenCalled();
  });

  // #589: a truthiness check is not a type check. express.urlencoded parses a
  // repeated key to an array, which sails past each route's `if (!groupName)`
  // and used to blow up on `name.toLowerCase()` inside findGroupByName as an
  // unhandled 500. The guard now lives in the repository, so these assert the
  // routes answer with their own declared error instead. verifyGroupExists is
  // mocked here, so the mock has to mirror the real contract — return null for
  // anything that isn't a usable string — or the regression is untestable at
  // this layer.
  describe('malformed group params answer the route error, not a 500 (#589)', () => {
    beforeEach(() => {
      verifyGroupExists.mockImplementation(async (name) =>
        typeof name === 'string' && name.trim() !== '' ? name : null,
      );
    });

    test.each([
      ['an array', ['a', 'b']],
      ['whitespace only', '   '],
    ])('getFullGrid returns 400 when gameName is %s', async (_l, gameName) => {
      const req = {
        body: { gameName, gameYear: '2024' },
        method: 'POST',
        url: '/getFullGrid',
      };
      const res = mockRes();
      await getFullGrid(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Validation Error',
          field: 'gameName',
        }),
      );
      expect(buildFullGridData).not.toHaveBeenCalled();
    });

    test('getFullGridCSV returns 400 when gameName is an array', async () => {
      const req = {
        query: { gameName: ['a', 'b'], gameYear: '2024' },
        method: 'GET',
        url: '/getFullGridCSV',
      };
      const res = { ...mockRes(), setHeader: vi.fn() };
      await getFullGridCSV(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(buildFullGridData).not.toHaveBeenCalled();
      expect(res.setHeader).not.toHaveBeenCalled();
    });

    test.each([
      '//evil.example',
      'https://evil.example',
      '/optionB',
      'javascript:alert(1)',
    ])(
      'gameView redirects home for invalid game despite from=%s',
      async (from) => {
        const res = mockRes();
        await gameView(
          {
            body: { game: ['a', 'b'], from },
            query: { from },
            method: 'POST',
            url: '/gameView',
          },
          res,
        );

        expect(res.redirect).toHaveBeenCalledWith('/?error=true');
        expect(res.status).not.toHaveBeenCalled();
        expect(buildGameViewData).not.toHaveBeenCalled();
      },
    );
  });

  test('getFullGridCSV canonicalizes both the read and the filename', async () => {
    verifyGroupExists.mockResolvedValue('House');
    buildFullGridData.mockResolvedValue({
      groupData: [],
      allTeamsWithPickCounts: [],
    });
    const req = {
      query: { gameName: 'house', gameYear: '2024' },
      method: 'GET',
      url: '/getFullGridCSV',
    };
    const res = { ...mockRes(), setHeader: vi.fn() };
    await getFullGridCSV(req, res);

    expect(buildFullGridData).toHaveBeenCalledWith('House', 2024);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="fullgrid-House-2024.csv"',
    );
  });

  test('getFullGridCSV returns 400 for a group that does not exist', async () => {
    verifyGroupExists.mockResolvedValue(null);
    const req = {
      query: { gameName: 'NoSuchGroup', gameYear: '2024' },
      method: 'GET',
      url: '/getFullGridCSV',
    };
    const res = { ...mockRes(), setHeader: vi.fn() };
    await getFullGridCSV(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(buildFullGridData).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getFullGridCSV — numeric integrity of the real export
// ---------------------------------------------------------------------------

describe('getFullGridCSV numeric integrity', () => {
  test('score columns come through as exact plain numbers while a hostile name is neutralized', async () => {
    buildFullGridData.mockResolvedValue({
      groupData: [
        {
          rank: 1,
          person: '=HYPERLINK("http://evil")',
          teamName: 'Legit Team',
          totalPoints: 87,
          teamsRemaining: 3,
          teamsAdvanced: 5,
          highestPlace: 1,
          possPoints: 120,
          pickNames: [{ sID: 10 }, { sID: 20 }],
        },
        {
          rank: 2,
          person: 'Jordan',
          teamName: 'Benign',
          totalPoints: 0,
          teamsRemaining: 0,
          teamsAdvanced: 0,
          highestPlace: 2,
          possPoints: 64,
          pickNames: [{ sID: 20 }],
        },
      ],
      allTeamsWithPickCounts: [
        { sID: 10, seed: 1, name: 'Duke', gameStatus: ['W'] },
        { sID: 20, seed: 2, name: 'Kansas', gameStatus: [] },
      ],
    });
    const req = {
      query: { gameName: 'House', gameYear: '2024' },
      method: 'GET',
      url: '/getFullGridCSV',
    };
    const res = { ...mockRes(), setHeader: vi.fn() };

    await getFullGridCSV(req, res);

    const csv = res.send.mock.calls[0][0];
    const [, , row1, row2] = csv.split('\r\n');

    // Row 1: the hostile name is neutralized, but every numeric column is the
    // exact unprefixed number — a wrongly-applied neutralization here would
    // turn scores into text and corrupt the standings export.
    const cells1 = row1.split(',');
    expect(cells1[0]).toBe('1'); // Rank
    expect(cells1[1]).toBe('"\'=HYPERLINK(""http://evil"")"'); // Entry (neutralized)
    expect(cells1[2]).toBe('Legit Team'); // Team
    expect(cells1[3]).toBe('87'); // Points
    expect(cells1[4]).toBe('3'); // Teams Remaining
    expect(cells1[5]).toBe('5'); // Advanced
    expect(cells1[6]).toBe('1'); // Best Rank
    expect(cells1[7]).toBe('120'); // Max Score
    expect(cells1[8]).toBe('1'); // pick index for Duke
    expect(cells1[9]).toBe('2'); // pick index for Kansas

    // Row 2: zeros and benign strings pass through untouched.
    const cells2 = row2.split(',');
    expect(cells2.slice(0, 8)).toEqual([
      '2',
      'Jordan',
      'Benign',
      '0',
      '0',
      '0',
      '2',
      '64',
    ]);

    // No numeric cell anywhere in the data rows picked up a quote prefix.
    expect(
      [...cells1.slice(3, 10), ...cells2.slice(3, 8)].every(
        (c) => !c.startsWith("'"),
      ),
    ).toBe(true);
  });
});

// #555 — gameView is the controller behind the main public results page (every
// visitor, every group, every year) and had no test at all: lines 156-194 were
// entirely uncovered. Two behaviors in there are load-bearing and neither was
// asserted anywhere — the signed-in highlighting is a privacy boundary, and the
// redirect-instead-of-throw on a bad group diverges from its siblings on purpose.
describe('gameView', () => {
  const GAME_VIEW_DATA = {
    groupData: [{ entryId: 1 }],
    enrichedActiveGames: [{ gameId: 10 }],
    allTeamsRaw: [{ teamSID: 'T1' }],
    allYears: [2023, 2024],
    regionNames: ['East'],
    conferenceStats: { ACC: 3 },
  };

  beforeEach(() => {
    buildGameViewData.mockResolvedValue(GAME_VIEW_DATA);
    getEntryIdsForUserInGroup.mockResolvedValue([]);
  });

  function gameViewReq(body = {}, session) {
    return { body, session, method: 'POST', url: '/gameView' };
  }

  test('a missing group redirects home and never builds the view data', async () => {
    const res = mockRes();

    await gameView(gameViewReq({}), res);

    expect(res.redirect).toHaveBeenCalledWith('/?error=true');
    expect(buildGameViewData).not.toHaveBeenCalled();
    expect(res.render).not.toHaveBeenCalled();
  });

  // The redirect (rather than the ValidationError its siblings in this file
  // throw) is deliberate: this route is reached from a form submit, not fetch.
  // A later "make the controllers consistent" pass would flatten it silently.
  test('an unknown group redirects home instead of throwing', async () => {
    verifyGroupExists.mockResolvedValue(undefined);
    const res = mockRes();

    await gameView(gameViewReq({ game: 'NoSuchGroup' }), res);

    expect(res.redirect).toHaveBeenCalledWith('/?error=true');
    expect(buildGameViewData).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('a case-variant group name is canonicalized before the read and the render', async () => {
    verifyGroupExists.mockResolvedValue('Default');
    const res = mockRes();

    await gameView(gameViewReq({ game: 'default' }), res);

    expect(verifyGroupExists).toHaveBeenCalledWith('default');
    expect(buildGameViewData).toHaveBeenCalledWith('Default', 2024);
    expect(res.render).toHaveBeenCalledWith(
      'results',
      expect.objectContaining({ name: 'Default' }),
    );
  });

  test('an absent year falls back to thisYear', async () => {
    const res = mockRes();

    await gameView(gameViewReq({ game: 'Family' }), res);

    expect(buildGameViewData).toHaveBeenCalledWith('Family', 2024);
    expect(res.render).toHaveBeenCalledWith(
      'results',
      expect.objectContaining({ currentYear: 2024, requestedYear: 2024 }),
    );
  });

  test('an explicit year is passed through', async () => {
    const res = mockRes();

    await gameView(gameViewReq({ game: 'Family', year: '2023' }), res);

    expect(buildGameViewData).toHaveBeenCalledWith('Family', 2023);
  });

  test('a malformed year is a 400, not a silent fallback', async () => {
    const res = mockRes();

    await gameView(gameViewReq({ game: 'Family', year: 'not-a-year' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Validation Error' }),
    );
    expect(buildGameViewData).not.toHaveBeenCalled();
  });

  test('an anonymous visitor renders no entry IDs and triggers no per-user lookup', async () => {
    const res = mockRes();

    await gameView(gameViewReq({ game: 'Family' }), res);

    expect(getEntryIdsForUserInGroup).not.toHaveBeenCalled();
    expect(res.render).toHaveBeenCalledWith(
      'results',
      expect.objectContaining({ myEntryIds: [] }),
    );
  });

  // The regression guard for the privacy boundary at resultsController.js:184-191.
  // Matching happens on the server and only entry IDs reach the view, so no
  // participant email ever lands on this public page. A refactor that passed
  // signedInEmail into the render, or folded myEntryIds into the cached payload,
  // would leak one participant's data to every other visitor of that group —
  // and, before this test, nothing would have failed.
  test('a signed-in participant gets entry IDs and no email reaches the view', async () => {
    getEntryIdsForUserInGroup.mockResolvedValue([7, 9]);
    const res = mockRes();

    await gameView(
      gameViewReq({ game: 'Family' }, { userEmail: 'player@example.com' }),
      res,
    );

    expect(getEntryIdsForUserInGroup).toHaveBeenCalledWith(
      'player@example.com',
      'Family',
      2024,
    );
    const [view, locals] = res.render.mock.calls[0];
    expect(view).toBe('results');
    expect(locals.myEntryIds).toEqual([7, 9]);
    expect(JSON.stringify(locals)).not.toContain('player@example.com');
  });

  // The `||` fallback on line 184: an admin browsing the page without a
  // participant session still gets their own entries highlighted.
  test('an admin-only session resolves entry IDs via the adminEmail fallback', async () => {
    getEntryIdsForUserInGroup.mockResolvedValue([3]);
    const res = mockRes();

    await gameView(
      gameViewReq({ game: 'Family' }, { adminEmail: 'admin@example.com' }),
      res,
    );

    expect(getEntryIdsForUserInGroup).toHaveBeenCalledWith(
      'admin@example.com',
      'Family',
      2024,
    );
    expect(res.render).toHaveBeenCalledWith(
      'results',
      expect.objectContaining({ myEntryIds: [3] }),
    );
  });

  // `private` is what keeps a response carrying one user's myEntryIds off any
  // shared cache, so it belongs in a test rather than only in a header.
  test('the response is marked privately cacheable', async () => {
    const res = mockRes();

    await gameView(
      gameViewReq({ game: 'Family' }, { userEmail: 'player@example.com' }),
      res,
    );

    expect(res.set).toHaveBeenCalledWith(
      'Cache-Control',
      'private, max-age=300',
    );
  });

  test('the built view data is passed through to the template', async () => {
    const res = mockRes();

    await gameView(gameViewReq({ game: 'Family' }), res);

    expect(res.render).toHaveBeenCalledWith(
      'results',
      expect.objectContaining({
        groupData: GAME_VIEW_DATA.groupData,
        gameData: GAME_VIEW_DATA.enrichedActiveGames,
        teamData: GAME_VIEW_DATA.allTeamsRaw,
        availableYears: GAME_VIEW_DATA.allYears,
        regions: GAME_VIEW_DATA.regionNames,
        conferenceStats: GAME_VIEW_DATA.conferenceStats,
      }),
    );
  });
});
