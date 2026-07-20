import {
  calculateMaxPoints,
  getFullGridCSV,
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
    },
    payments: { collectorName: '', collectorEmail: '', collectorPhone: '' },
  },
}));

import {
  calculateMaxPossiblePoints,
  buildFullGridData,
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
