// Comprehensive tests for runEspnPoll. Mocks every external boundary
// (gameRepository, gameService, pointsService, espnService) so the service's
// orchestration logic — fetch → match → dedupe → write → recompute — is
// exercised in isolation.
import { runEspnPoll } from '../src/services/pollService.js';

// vi.hoisted ensures mock state exists before the hoisted vi.mock factories run.
const {
  gameRepoMock,
  updateTeamRecordsMock,
  updatePointsMock,
  fetchCompletedMock,
  getDateStrDaysAgoMock,
} = vi.hoisted(() => ({
  gameRepoMock: { getActiveAndFutureGames: vi.fn() },
  updateTeamRecordsMock: vi.fn(),
  updatePointsMock: vi.fn(),
  fetchCompletedMock: vi.fn(),
  getDateStrDaysAgoMock: vi.fn().mockReturnValue('20260516'),
}));

vi.mock('../src/repositories/index.js', () => ({
  gameRepository: gameRepoMock,
}));
vi.mock('../src/services/gameService.js', () => ({
  updateTeamRecords: updateTeamRecordsMock,
}));
vi.mock('../src/services/pointsService.js', () => ({
  updatePointsForAffectedEntries: updatePointsMock,
}));
vi.mock('../src/services/espnService.js', () => ({
  fetchCompletedTournamentGames: fetchCompletedMock,
  getDateStrDaysAgo: getDateStrDaysAgoMock,
}));

// Real espnTeamMap is loaded via require — we don't need to mock it because
// the file exists in the repo. Tests use real team names that resolve to sIDs.
// Duke = 28, Kansas = 73 (per espnTeamMap.json). See file for full list.

beforeEach(() => {
  vi.clearAllMocks();
  fetchCompletedMock.mockResolvedValue([]);
});

describe('runEspnPoll — early-exits', () => {
  test('returns the empty summary when there are no unresolved DB games', async () => {
    gameRepoMock.getActiveAndFutureGames.mockResolvedValue([
      { gameID: 1, winner: 28 }, // already resolved
    ]);

    const result = await runEspnPoll(2024);

    expect(result).toEqual({ updated: 0, skipped: 0, unmapped: [], games: [] });
    expect(fetchCompletedMock).not.toHaveBeenCalled();
    expect(updateTeamRecordsMock).not.toHaveBeenCalled();
  });

  test('returns the empty summary when ESPN returns zero completed games', async () => {
    gameRepoMock.getActiveAndFutureGames.mockResolvedValue([
      { gameID: 1, winner: null, team1ID: 28, team2ID: 73 },
    ]);
    fetchCompletedMock.mockResolvedValue([]);

    const result = await runEspnPoll(2024);

    expect(result.updated).toBe(0);
    expect(updateTeamRecordsMock).not.toHaveBeenCalled();
    expect(updatePointsMock).not.toHaveBeenCalled();
  });
});

describe('runEspnPoll — happy path', () => {
  test('matches a completed ESPN game to an unresolved DB game and writes the result', async () => {
    gameRepoMock.getActiveAndFutureGames.mockResolvedValue([
      { gameID: 42, round: 1, winner: null, team1ID: 28, team2ID: 73, nextGameID: 50, nextGameSpot: 1 },
    ]);
    fetchCompletedMock.mockResolvedValue([
      {
        espnEventId: 'evt-1',
        team1DisplayName: 'Duke Blue Devils',
        team2DisplayName: 'Kansas Jayhawks',
        winnerDisplayName: 'Duke Blue Devils',
      },
    ]);
    updateTeamRecordsMock.mockResolvedValue();
    updatePointsMock.mockResolvedValue();

    const result = await runEspnPoll(2024);

    expect(updateTeamRecordsMock).toHaveBeenCalledWith(28, 73, 1, 42, 50, 1, 2024);
    expect(result.updated).toBe(1);
    expect(result.games).toHaveLength(1);
    expect(result.games[0]).toMatchObject({ gameID: 42, winnerSID: 28, loserSID: 73 });
    expect(updatePointsMock).toHaveBeenCalledWith(2024, expect.arrayContaining([28, 73]));
  });

  test('matches when team1ID/team2ID order is reversed from ESPN winner orientation', async () => {
    // DB has team1=Kansas, team2=Duke. ESPN says Duke won.
    gameRepoMock.getActiveAndFutureGames.mockResolvedValue([
      { gameID: 42, round: 1, winner: null, team1ID: 73, team2ID: 28, nextGameID: 0, nextGameSpot: 0 },
    ]);
    fetchCompletedMock.mockResolvedValue([
      {
        espnEventId: 'evt-2',
        team1DisplayName: 'Duke Blue Devils',
        team2DisplayName: 'Kansas Jayhawks',
        winnerDisplayName: 'Duke Blue Devils',
      },
    ]);
    updateTeamRecordsMock.mockResolvedValue();
    updatePointsMock.mockResolvedValue();

    const result = await runEspnPoll(2024);

    expect(updateTeamRecordsMock).toHaveBeenCalledWith(28, 73, 1, 42, 0, 0, 2024);
    expect(result.updated).toBe(1);
  });
});

describe('runEspnPoll — dedup, skip, unmapped', () => {
  test('dedupes ESPN games appearing in both today and yesterday by espnEventId', async () => {
    gameRepoMock.getActiveAndFutureGames.mockResolvedValue([
      { gameID: 42, round: 1, winner: null, team1ID: 28, team2ID: 73, nextGameID: 0, nextGameSpot: 0 },
    ]);
    const dup = {
      espnEventId: 'evt-dup',
      team1DisplayName: 'Duke Blue Devils',
      team2DisplayName: 'Kansas Jayhawks',
      winnerDisplayName: 'Duke Blue Devils',
    };
    // today + yesterday both return the same game
    fetchCompletedMock.mockResolvedValueOnce([dup]).mockResolvedValueOnce([dup]);
    updateTeamRecordsMock.mockResolvedValue();
    updatePointsMock.mockResolvedValue();

    const result = await runEspnPoll(2024);

    // Dedupe should mean exactly one write, not two
    expect(updateTeamRecordsMock).toHaveBeenCalledTimes(1);
    expect(result.updated).toBe(1);
  });

  test('skips ESPN games with no matching unresolved DB game', async () => {
    gameRepoMock.getActiveAndFutureGames.mockResolvedValue([
      // Different teams than ESPN reports
      { gameID: 42, round: 1, winner: null, team1ID: 41, team2ID: 55, nextGameID: 0, nextGameSpot: 0 },
    ]);
    fetchCompletedMock.mockResolvedValue([
      {
        espnEventId: 'evt-skip',
        team1DisplayName: 'Duke Blue Devils',
        team2DisplayName: 'Kansas Jayhawks',
        winnerDisplayName: 'Duke Blue Devils',
      },
    ]);

    const result = await runEspnPoll(2024);

    expect(result.skipped).toBe(1);
    expect(result.updated).toBe(0);
    expect(updateTeamRecordsMock).not.toHaveBeenCalled();
  });

  test('records unmapped team names without crashing', async () => {
    gameRepoMock.getActiveAndFutureGames.mockResolvedValue([
      { gameID: 42, round: 1, winner: null, team1ID: 28, team2ID: 73, nextGameID: 0, nextGameSpot: 0 },
    ]);
    fetchCompletedMock.mockResolvedValue([
      {
        espnEventId: 'evt-unmapped',
        team1DisplayName: 'Imaginary University Phoenixes',
        team2DisplayName: 'Duke Blue Devils',
        winnerDisplayName: 'Imaginary University Phoenixes',
      },
    ]);

    const result = await runEspnPoll(2024);

    expect(result.unmapped).toContain('Imaginary University Phoenixes');
    expect(result.updated).toBe(0);
    expect(updateTeamRecordsMock).not.toHaveBeenCalled();
  });
});

describe('runEspnPoll — dry-run', () => {
  test('dry-run reports games as updated without invoking write paths', async () => {
    gameRepoMock.getActiveAndFutureGames.mockResolvedValue([
      { gameID: 42, round: 1, winner: null, team1ID: 28, team2ID: 73, nextGameID: 0, nextGameSpot: 0 },
    ]);
    fetchCompletedMock.mockResolvedValue([
      {
        espnEventId: 'evt-dryrun',
        team1DisplayName: 'Duke Blue Devils',
        team2DisplayName: 'Kansas Jayhawks',
        winnerDisplayName: 'Duke Blue Devils',
      },
    ]);

    const result = await runEspnPoll(2024, { dryRun: true });

    expect(result.updated).toBe(1);
    expect(result.games).toHaveLength(1);
    // Critical: no DB writes in dry-run
    expect(updateTeamRecordsMock).not.toHaveBeenCalled();
    expect(updatePointsMock).not.toHaveBeenCalled();
  });
});

describe('runEspnPoll — date override and error propagation', () => {
  test('with explicit dateStr, fetches only that date and skips yesterday lookup', async () => {
    gameRepoMock.getActiveAndFutureGames.mockResolvedValue([
      { gameID: 1, winner: null, team1ID: 28, team2ID: 73, round: 1, nextGameID: 0, nextGameSpot: 0 },
    ]);
    fetchCompletedMock.mockResolvedValue([]);

    await runEspnPoll(2024, { dateStr: '20260517' });

    expect(fetchCompletedMock).toHaveBeenCalledTimes(1);
    expect(fetchCompletedMock).toHaveBeenCalledWith('20260517');
    expect(getDateStrDaysAgoMock).not.toHaveBeenCalled();
  });

  test('with no dateStr, fetches today and yesterday in parallel', async () => {
    gameRepoMock.getActiveAndFutureGames.mockResolvedValue([
      { gameID: 1, winner: null, team1ID: 28, team2ID: 73, round: 1, nextGameID: 0, nextGameSpot: 0 },
    ]);
    fetchCompletedMock.mockResolvedValue([]);

    await runEspnPoll(2024);

    expect(fetchCompletedMock).toHaveBeenCalledTimes(2);
    expect(fetchCompletedMock).toHaveBeenNthCalledWith(1);
    expect(fetchCompletedMock).toHaveBeenNthCalledWith(2, '20260516');
  });

  test('rethrows ESPN fetch errors instead of swallowing', async () => {
    gameRepoMock.getActiveAndFutureGames.mockResolvedValue([
      { gameID: 1, winner: null, team1ID: 28, team2ID: 73, round: 1, nextGameID: 0, nextGameSpot: 0 },
    ]);
    const boom = new Error('ESPN 503');
    fetchCompletedMock.mockRejectedValue(boom);

    await expect(runEspnPoll(2024)).rejects.toBe(boom);
  });

  test('continues recording other games when one updateTeamRecords promise rejects', async () => {
    gameRepoMock.getActiveAndFutureGames.mockResolvedValue([
      { gameID: 1, round: 1, winner: null, team1ID: 28, team2ID: 73, nextGameID: 0, nextGameSpot: 0 },
      { gameID: 2, round: 1, winner: null, team1ID: 41, team2ID: 55, nextGameID: 0, nextGameSpot: 0 },
    ]);
    fetchCompletedMock.mockResolvedValue([
      {
        espnEventId: 'a',
        team1DisplayName: 'Duke Blue Devils',
        team2DisplayName: 'Kansas Jayhawks',
        winnerDisplayName: 'Duke Blue Devils',
      },
      {
        espnEventId: 'b',
        team1DisplayName: 'Alabama Crimson Tide',
        team2DisplayName: 'Arizona Wildcats',
        winnerDisplayName: 'Alabama Crimson Tide',
      },
    ]);
    updateTeamRecordsMock
      .mockResolvedValueOnce() // first succeeds
      .mockRejectedValueOnce(new Error('write conflict')); // second fails
    updatePointsMock.mockResolvedValue();

    const result = await runEspnPoll(2024);

    expect(result.updated).toBe(1); // only successful write counts
    expect(updatePointsMock).toHaveBeenCalled(); // points still recomputed
  });

  test('does NOT recompute points when no games were updated', async () => {
    gameRepoMock.getActiveAndFutureGames.mockResolvedValue([
      { gameID: 1, winner: null, team1ID: 28, team2ID: 73, round: 1, nextGameID: 0, nextGameSpot: 0 },
    ]);
    // ESPN game references unmapped teams → no writes
    fetchCompletedMock.mockResolvedValue([
      {
        espnEventId: 'evt',
        team1DisplayName: 'Imaginary',
        team2DisplayName: 'Fictional',
        winnerDisplayName: 'Imaginary',
      },
    ]);

    await runEspnPoll(2024);

    expect(updatePointsMock).not.toHaveBeenCalled();
  });
});
