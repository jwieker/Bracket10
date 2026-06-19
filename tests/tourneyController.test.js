import {
  regionVerify,
  gamesVerify,
  viewTournament,
  tournamentUpdate,
  deleteTournamentHandler,
  pollEspnScheduled,
} from '../src/controllers/tourneyController.js';

vi.mock('../src/services/index.js', () => ({
  prepareRegionVerifyData: vi.fn(),
  createNewBracket: vi.fn(),
  updateBracket: vi.fn(),
  updateEntrywithNewSchools: vi.fn(),
  deleteTournament: vi.fn(),
  getTournamentData: vi.fn(),
}));

vi.mock('../src/repositories/index.js', () => ({
  gameRepository: { getAllTournamentDetails: vi.fn() },
}));

// Mock module for module-based function that imports JSON
vi.mock('../src/services/espnService.js', () => ({
  fetchScheduledTournamentGames: vi.fn(),
  loadTeamMap: vi.fn(),
}));

import {
  prepareRegionVerifyData,
  createNewBracket,
  updateBracket,
  updateEntrywithNewSchools,
  deleteTournament,
} from '../src/services/index.js';
import { gameRepository } from '../src/repositories/index.js';
import { fetchScheduledTournamentGames, loadTeamMap } from '../src/services/espnService.js';

function mockRes() {
  return {
    render: vi.fn(),
    redirect: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('regionVerify', () => {
  test('parses four region numbers and calls prepareRegionVerifyData', async () => {
    prepareRegionVerifyData.mockResolvedValue({ teams: [], games: [] });
    const req = {
      body: { region0: '1', region1: '2', region2: '3', region3: '4', year: '2024' },
      method: 'POST', url: '/regionVerify',
    };
    const res = mockRes();
    await regionVerify(req, res);
    expect(prepareRegionVerifyData).toHaveBeenCalledWith([1, 2, 3, 4], 2024);
    expect(res.render).toHaveBeenCalledWith('newTourneyGames', expect.objectContaining({ year: 2024 }));
  });
});

describe('gamesVerify', () => {
  test('calls createNewBracket and returns 200', async () => {
    createNewBracket.mockResolvedValue();
    const req = {
      body: { year: '2024', region: '1,2,3,4', games: [{ id: 1 }] },
      method: 'POST', url: '/gamesVerify',
    };
    const res = mockRes();
    await gamesVerify(req, res);
    expect(createNewBracket).toHaveBeenCalledWith([{ id: 1 }], 2024, [1, 2, 3, 4]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ message: 'New Bracket Created Successfully' });
  });
});

describe('viewTournament', () => {
  test('fetches tournament details and renders editTourneyGames', async () => {
    gameRepository.getAllTournamentDetails.mockResolvedValue({
      allGames: [{ gameID: 1 }],
      regions: [{ regionID: 1 }, { regionID: 2 }],
    });
    prepareRegionVerifyData.mockResolvedValue({ teams: [] });

    const req = { body: { year: '2024' }, method: 'POST', url: '/viewTournament' };
    const res = mockRes();
    await viewTournament(req, res);

    expect(gameRepository.getAllTournamentDetails).toHaveBeenCalledWith(2024);
    expect(prepareRegionVerifyData).toHaveBeenCalledWith([1, 2], 2024);
    expect(res.render).toHaveBeenCalledWith('editTourneyGames', expect.objectContaining({
      year: 2024,
      existingGames: [{ gameID: 1 }],
    }));
  });
});

describe('tournamentUpdate', () => {
  test('calls updateBracket and updateEntrywithNewSchools, returns 200', async () => {
    updateBracket.mockResolvedValue({ old: 1, new: 2 });
    updateEntrywithNewSchools.mockResolvedValue();
    const req = {
      body: { year: '2024', region0: '1', region1: '2', region2: '3', region3: '4', games: [] },
      method: 'POST', url: '/tournamentUpdate',
    };
    const res = mockRes();
    await tournamentUpdate(req, res);
    expect(updateBracket).toHaveBeenCalledWith([], 2024, [1, 2, 3, 4]);
    expect(updateEntrywithNewSchools).toHaveBeenCalledWith({ old: 1, new: 2 }, 2024);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('deleteTournamentHandler', () => {
  test('calls deleteTournament and returns 200 with year in message', async () => {
    deleteTournament.mockResolvedValue();
    const req = { body: { year: '2024' }, method: 'POST', url: '/deleteTournament' };
    const res = mockRes();
    await deleteTournamentHandler(req, res);
    expect(deleteTournament).toHaveBeenCalledWith(2024);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ message: 'Tournament for 2024 deleted successfully' });
  });
});

describe('pollEspnScheduled', () => {
  test('fetches games and resolves sIDs using teamMap', async () => {
    loadTeamMap.mockReturnValue({
      'Duke Blue Devils': 264,
      'Kansas Jayhawks': 2305,
    });
    fetchScheduledTournamentGames.mockResolvedValueOnce([
      { espnEventId: '1', team1DisplayName: 'Duke Blue Devils', team2DisplayName: 'Kansas Jayhawks' },
    ]);

    const req = {
      body: { date1: '20240321' },
      method: 'POST', url: '/pollEspnScheduled',
    };
    const res = mockRes();

    await pollEspnScheduled(req, res);

    expect(loadTeamMap).toHaveBeenCalled();
    expect(fetchScheduledTournamentGames).toHaveBeenCalledWith('20240321');
    expect(res.json).toHaveBeenCalledWith({
      games: [
        {
          espnEventId: '1',
          team1DisplayName: 'Duke Blue Devils',
          team2DisplayName: 'Kansas Jayhawks',
          team1SID: 264,
          team2SID: 2305,
        },
      ],
    });
  });

  test('handles missing team mapping gracefully', async () => {
    loadTeamMap.mockReturnValue({});
    fetchScheduledTournamentGames.mockResolvedValueOnce([
      { espnEventId: '2', team1DisplayName: 'Unknown Team', team2DisplayName: 'Another Unknown' },
    ]);

    const req = {
      body: { date1: '20240322' },
      method: 'POST', url: '/pollEspnScheduled',
    };
    const res = mockRes();

    await pollEspnScheduled(req, res);

    expect(res.json).toHaveBeenCalledWith({
      games: [
        {
          espnEventId: '2',
          team1DisplayName: 'Unknown Team',
          team2DisplayName: 'Another Unknown',
          team1SID: null,
          team2SID: null,
        },
      ],
    });
  });
});
