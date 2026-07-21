import { getPlayground } from '../src/controllers/playgroundController.js';

vi.mock('../src/services/playgroundService.js', () => ({
  buildPlaygroundData: vi.fn(),
}));

import { buildPlaygroundData } from '../src/services/playgroundService.js';

function mockRes() {
  return {
    render: vi.fn(),
    set: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

function mockReq(query = {}) {
  return { body: {}, query, method: 'GET', url: '/playground' };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getPlayground', () => {
  test('returns 400 when group is missing', async () => {
    const res = mockRes();
    await getPlayground(mockReq({}), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Validation Error' }),
    );
  });

  test('returns 400 when year is non-numeric', async () => {
    const res = mockRes();
    await getPlayground(mockReq({ group: 'Family', year: 'notanumber' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('renders playground with data when group and valid year are provided', async () => {
    const playgroundData = {
      entries: [],
      schoolRecords: [],
      pendingGames: [],
      allGamesForClient: [],
      roundPoints: [],
      roundNames: [],
    };
    buildPlaygroundData.mockResolvedValue(playgroundData);

    const res = mockRes();
    await getPlayground(mockReq({ group: 'Family', year: '2024' }), res);
    expect(buildPlaygroundData).toHaveBeenCalledWith('Family', 2024);
    expect(res.render).toHaveBeenCalledWith(
      'playground',
      expect.objectContaining({
        groupName: 'Family',
        gameYear: 2024,
      }),
    );
  });

  test('uses thisYear when year query param is not provided', async () => {
    const playgroundData = {
      entries: [],
      schoolRecords: [],
      pendingGames: [],
      allGamesForClient: [],
      roundPoints: [],
      roundNames: [],
    };
    buildPlaygroundData.mockResolvedValue(playgroundData);

    const res = mockRes();
    await getPlayground(mockReq({ group: 'TestGroup' }), res);
    expect(buildPlaygroundData).toHaveBeenCalledWith(
      'TestGroup',
      expect.any(Number),
    );
  });
});
