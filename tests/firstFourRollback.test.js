import {
  createFirstFourGames,
  setRepositories,
} from '../src/services/tourneyService.js';

const { loggerErrorMock } = vi.hoisted(() => ({ loggerErrorMock: vi.fn() }));

vi.mock('../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: loggerErrorMock,
    debug: vi.fn(),
    performance: vi.fn(),
  },
}));

const regionArray = [1, 2, 3, 4];
const firstFourData = [
  { team1ID: 101, team2ID: 102, seed: 16, nextGameID: 1, nextGameSpot: 1 },
  { team1ID: 103, team2ID: 104, seed: 11, nextGameID: 16, nextGameSpot: 2 },
];

function makeRepo(overrides = {}) {
  return {
    insertFirstFourGames: vi.fn().mockResolvedValue(),
    insertFirstFourSchoolRecords: vi.fn().mockResolvedValue(),
    deleteFirstFourGames: vi.fn().mockResolvedValue(),
    ...overrides,
  };
}

describe('createFirstFourGames atomicity (#175)', () => {
  beforeEach(() => vi.clearAllMocks());

  test('writes games then school records on the happy path (no rollback)', async () => {
    const repo = makeRepo();
    setRepositories(repo, {}, {}, {});

    await createFirstFourGames(firstFourData, 2026, regionArray);

    expect(repo.insertFirstFourGames).toHaveBeenCalledTimes(1);
    expect(repo.insertFirstFourSchoolRecords).toHaveBeenCalledTimes(1);
    expect(repo.deleteFirstFourGames).not.toHaveBeenCalled();
    // Two games written (gameIDs start at 64).
    const [games] = repo.insertFirstFourGames.mock.calls[0];
    expect(games.map((g) => g.gameID)).toEqual([64, 65]);
  });

  test('rolls back the written games when the school-records write fails', async () => {
    const boom = new Error('records batch failed');
    const repo = makeRepo({
      insertFirstFourSchoolRecords: vi.fn().mockRejectedValue(boom),
    });
    setRepositories(repo, {}, {}, {});

    await expect(
      createFirstFourGames(firstFourData, 2026, regionArray),
    ).rejects.toBe(boom);

    expect(repo.insertFirstFourGames).toHaveBeenCalledTimes(1);
    // The same games that were written are deleted as compensation.
    expect(repo.deleteFirstFourGames).toHaveBeenCalledTimes(1);
    const [deleted, year] = repo.deleteFirstFourGames.mock.calls[0];
    expect(deleted.map((g) => g.gameID)).toEqual([64, 65]);
    expect(year).toBe(2026);
    expect(loggerErrorMock).toHaveBeenCalled();
  });

  test('still rethrows the original error if rollback itself fails', async () => {
    const boom = new Error('records batch failed');
    const repo = makeRepo({
      insertFirstFourSchoolRecords: vi.fn().mockRejectedValue(boom),
      deleteFirstFourGames: vi
        .fn()
        .mockRejectedValue(new Error('rollback failed')),
    });
    setRepositories(repo, {}, {}, {});

    await expect(
      createFirstFourGames(firstFourData, 2026, regionArray),
    ).rejects.toBe(boom);
    // Both the failure and the failed-rollback are logged for manual cleanup.
    expect(loggerErrorMock).toHaveBeenCalledTimes(2);
  });
});
