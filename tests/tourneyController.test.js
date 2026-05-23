import {
  regionVerify,
  gamesVerify,
  viewTournament,
  tournamentUpdate,
  deleteTournamentHandler,
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

import {
  prepareRegionVerifyData,
  createNewBracket,
  updateBracket,
  updateEntrywithNewSchools,
  deleteTournament,
} from '../src/services/index.js';
import { gameRepository } from '../src/repositories/index.js';

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
