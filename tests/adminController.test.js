import {
  adminDashboard,
  adminTournamentPage,
  adminEntriesPage,
  adminTeamsPage,
  adminSystemPage,
  adminCloudPage,
  adminCloudBudgetRefresh,
  adminCloudDeploy,
  changeYear,
} from '../src/controllers/adminController.js';

vi.mock('../src/repositories/index.js', () => ({
  gameRepository: { getActiveGames: vi.fn() },
}));

vi.mock('../src/services/index.js', () => ({
  getTournamentData: vi.fn(),
  getBudgetStatus: vi.fn(),
  triggerProductionDeploy: vi.fn(),
  getCloudConsoleLinks: vi.fn(() => ({
    projectId: 'test-proj',
    deployBranch: 'main',
    firestore: 'https://example/fs',
  })),
}));

import { gameRepository } from '../src/repositories/index.js';
import {
  getTournamentData,
  getBudgetStatus,
  triggerProductionDeploy,
} from '../src/services/index.js';

function mockRes() {
  return {
    render: vi.fn(),
    redirect: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

function mockReq(overrides = {}) {
  return { body: {}, query: {}, method: 'GET', url: '/admin', ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('adminDashboard', () => {
  test('redirects to /admin/tournament', async () => {
    const res = mockRes();
    await adminDashboard(mockReq(), res);
    expect(res.redirect).toHaveBeenCalledWith('/admin/tournament');
  });
});

describe('adminTournamentPage', () => {
  test('renders adminTournament with enhanced games when active games exist', async () => {
    const activeGames = [
      {
        gameID: 1,
        winner: 10,
        team1ID: 10,
        team1Name: 'Duke',
        team2Name: 'UNC',
      },
      {
        gameID: 2,
        winner: null,
        team1ID: 5,
        team1Name: 'Kansas',
        team2Name: 'UCLA',
      },
    ];
    gameRepository.getActiveGames.mockResolvedValue(activeGames);

    const res = mockRes();
    await adminTournamentPage(mockReq({ query: { year: '2024' } }), res);

    expect(res.render).toHaveBeenCalledWith(
      'adminTournament',
      expect.objectContaining({
        isNewTournament: false,
        year: 2024,
      }),
    );

    const renderArgs = res.render.mock.calls[0][1];
    // Game with winner === team1ID should have winnerName = team1Name
    expect(renderArgs.activeGames[0].winnerName).toBe('Duke');
    // Game with no winner should not have winnerName
    expect(renderArgs.activeGames[1].winnerName).toBeUndefined();
  });

  test('renders with isNewTournament: true when no active games and getTournamentData returns new', async () => {
    gameRepository.getActiveGames.mockResolvedValue([]);
    getTournamentData.mockResolvedValue({ isNewTournament: true, year: 2025 });

    const res = mockRes();
    await adminTournamentPage(mockReq({ query: { year: '2025' } }), res);

    expect(res.render).toHaveBeenCalledWith(
      'adminTournament',
      expect.objectContaining({
        isNewTournament: true,
        year: 2025,
        activeGames: [],
      }),
    );
  });

  test('renders with isNewTournament: false when no active games and not new tournament', async () => {
    gameRepository.getActiveGames.mockResolvedValue([]);
    getTournamentData.mockResolvedValue({ isNewTournament: false, year: 2024 });

    const res = mockRes();
    await adminTournamentPage(mockReq({ query: { year: '2024' } }), res);

    expect(res.render).toHaveBeenCalledWith(
      'adminTournament',
      expect.objectContaining({
        isNewTournament: false,
      }),
    );
  });

  test('pins unresolved First Four (round 0) games to the top and keeps order otherwise', async () => {
    const activeGames = [
      { gameID: 5, round: 1, winner: null, team1ID: 1 },
      { gameID: 8, round: 1, winner: null, team1ID: 2 },
      { gameID: 2, round: 0, winner: null, team1ID: 3 },
      { gameID: 1, round: 0, winner: 30, team1ID: 30, team1Name: 'FF Winner' },
      { gameID: 3, round: 1, winner: 50, team1ID: 50, team1Name: 'R1 Winner' },
    ];
    gameRepository.getActiveGames.mockResolvedValue(activeGames);

    const res = mockRes();
    await adminTournamentPage(mockReq({ query: {} }), res);

    // Pending FF game first; completed FF game stays with the other
    // completed games in repository order.
    const renderArgs = res.render.mock.calls[0][1];
    expect(renderArgs.activeGames.map((g) => g.gameID)).toEqual([
      2, 5, 8, 1, 3,
    ]);
  });

  test('sets winner name to team2Name when winner !== team1ID', async () => {
    const activeGames = [
      {
        gameID: 1,
        winner: 20,
        team1ID: 10,
        team1Name: 'Duke',
        team2Name: 'UNC',
      },
    ];
    gameRepository.getActiveGames.mockResolvedValue(activeGames);

    const res = mockRes();
    await adminTournamentPage(mockReq({ query: {} }), res);

    const renderArgs = res.render.mock.calls[0][1];
    expect(renderArgs.activeGames[0].winnerName).toBe('UNC');
  });
});

describe('adminEntriesPage', () => {
  test('renders adminEntries with year', async () => {
    const res = mockRes();
    await adminEntriesPage(mockReq({ query: { year: '2024' } }), res);
    expect(res.render).toHaveBeenCalledWith(
      'adminEntries',
      expect.objectContaining({ year: 2024 }),
    );
  });
});

describe('adminTeamsPage', () => {
  test('renders adminTeams with year', async () => {
    const res = mockRes();
    await adminTeamsPage(mockReq({ query: { year: '2022' } }), res);
    expect(res.render).toHaveBeenCalledWith(
      'adminTeams',
      expect.objectContaining({ year: 2022 }),
    );
  });
});

describe('adminSystemPage', () => {
  test('renders adminSystem with year', async () => {
    const res = mockRes();
    await adminSystemPage(mockReq({ query: { year: '2023' } }), res);
    expect(res.render).toHaveBeenCalledWith(
      'adminSystem',
      expect.objectContaining({ year: 2023 }),
    );
  });
});

describe('changeYear', () => {
  test('redirects to /admin/tournament with year', async () => {
    const res = mockRes();
    await changeYear(mockReq({ body: { year: '2022' } }), res);
    expect(res.redirect).toHaveBeenCalledWith('/admin/tournament?year=2022');
  });
});

describe('adminCloudPage', () => {
  test('renders adminCloud with budget and links', async () => {
    getBudgetStatus.mockResolvedValue({ configured: true, budgets: [] });
    const res = mockRes();
    await adminCloudPage(mockReq({ query: { year: '2026' } }), res);
    expect(res.render).toHaveBeenCalledWith(
      'adminCloud',
      expect.objectContaining({
        year: 2026,
        budget: { configured: true, budgets: [] },
        links: expect.objectContaining({ projectId: 'test-proj' }),
      }),
    );
  });
});

describe('adminCloudBudgetRefresh', () => {
  test('returns budget JSON with force refresh', async () => {
    getBudgetStatus.mockResolvedValue({
      configured: true,
      budgets: [{ displayName: 'B', amount: 5, currency: 'USD' }],
    });
    const res = mockRes();
    await adminCloudBudgetRefresh(mockReq(), res);
    expect(getBudgetStatus).toHaveBeenCalledWith({ force: true });
    expect(res.json).toHaveBeenCalledWith({
      configured: true,
      budgets: [{ displayName: 'B', amount: 5, currency: 'USD' }],
    });
  });
});

describe('adminCloudDeploy', () => {
  test('returns 200 with build info on success', async () => {
    triggerProductionDeploy.mockResolvedValue({
      ok: true,
      buildId: 'abc',
      branch: 'main',
    });
    const res = mockRes();
    await adminCloudDeploy(mockReq({ method: 'POST' }), res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      buildId: 'abc',
      branch: 'main',
    });
  });

  test('returns 500 when trigger fails', async () => {
    triggerProductionDeploy.mockResolvedValue({ ok: false, error: 'boom' });
    const res = mockRes();
    await adminCloudDeploy(mockReq({ method: 'POST' }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: 'boom' });
  });
});
