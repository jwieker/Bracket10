import {
  getUnsentEmailEntries,
  markEmailsSent,
} from '../src/services/emailService.js';

// `vi.hoisted` lets us share mock state with the hoisted `vi.mock` factory
// without tripping the "cannot access before initialization" TDZ error.
const { entryRepoMock, gameRepoMock } = vi.hoisted(() => ({
  entryRepoMock: {
    getUnsentEmailEntries: vi.fn(),
    markEmailsSent: vi.fn(),
  },
  gameRepoMock: {
    getTournamentTeams: vi.fn(),
  },
}));

vi.mock('../src/repositories/index.js', () => ({
  entryRepository: entryRepoMock,
  gameRepository: gameRepoMock,
}));

vi.mock('../src/config/app.js', () => ({
  thisYear: 2024,
  APP_CONFIG: {
    tournament: { emailGroup: 'EmailList' },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  gameRepoMock.getTournamentTeams.mockResolvedValue([]);
});

describe('getUnsentEmailEntries', () => {
  test('joins entries with team names from the tournament teams using nameNick by preference', async () => {
    entryRepoMock.getUnsentEmailEntries.mockResolvedValue([
      { id: 1, picks: [101, 202] },
      { id: 2, picks: [101] },
    ]);
    gameRepoMock.getTournamentTeams.mockResolvedValue([
      { sID: 101, nameNick: 'Devils', name: 'Duke' },
      { sID: 202, name: 'Kansas' }, // no nameNick → fall through to name
    ]);

    const result = await getUnsentEmailEntries(2024);

    expect(result).toEqual([
      { id: 1, picks: [101, 202], pickNames: ['Devils', 'Kansas'] },
      { id: 2, picks: [101], pickNames: ['Devils'] },
    ]);
  });

  test('queries the configured EMAIL_GROUP from the entry repository', async () => {
    entryRepoMock.getUnsentEmailEntries.mockResolvedValue([]);

    await getUnsentEmailEntries(2024);

    expect(entryRepoMock.getUnsentEmailEntries).toHaveBeenCalledWith(
      'EmailList',
      2024,
    );
  });

  test('fetches tournament teams via the repository layer for the given year', async () => {
    entryRepoMock.getUnsentEmailEntries.mockResolvedValue([]);

    await getUnsentEmailEntries(2024);

    expect(gameRepoMock.getTournamentTeams).toHaveBeenCalledWith(2024);
  });

  test('defaults year to thisYear (2024) when omitted', async () => {
    entryRepoMock.getUnsentEmailEntries.mockResolvedValue([]);

    await getUnsentEmailEntries();

    expect(entryRepoMock.getUnsentEmailEntries).toHaveBeenCalledWith(
      'EmailList',
      2024,
    );
    expect(gameRepoMock.getTournamentTeams).toHaveBeenCalledWith(2024);
  });

  test('falls back to "Team {sID}" when a pick has no matching team at all', async () => {
    entryRepoMock.getUnsentEmailEntries.mockResolvedValue([
      { id: 1, picks: [999] },
    ]);
    // no tournament teams loaded (default empty mock from beforeEach)

    const result = await getUnsentEmailEntries(2024);

    expect(result[0].pickNames).toEqual(['Team 999']);
  });

  test('falls back to "Team {sID}" when the team has neither nameNick nor name', async () => {
    entryRepoMock.getUnsentEmailEntries.mockResolvedValue([
      { id: 1, picks: [101] },
    ]);
    gameRepoMock.getTournamentTeams.mockResolvedValue([{ sID: 101 }]);

    const result = await getUnsentEmailEntries(2024);

    expect(result[0].pickNames).toEqual(['Team 101']);
  });

  test('handles an entry with no picks field by treating it as empty array', async () => {
    entryRepoMock.getUnsentEmailEntries.mockResolvedValue([{ id: 1 }]);

    const result = await getUnsentEmailEntries(2024);

    expect(result[0].pickNames).toEqual([]);
  });
});

describe('markEmailsSent', () => {
  test('delegates to entryRepository with ids and year', async () => {
    entryRepoMock.markEmailsSent.mockResolvedValue();

    await markEmailsSent([1, 2, 3], 2024);

    expect(entryRepoMock.markEmailsSent).toHaveBeenCalledWith([1, 2, 3], 2024);
  });

  test('defaults year to thisYear (2024) when omitted', async () => {
    entryRepoMock.markEmailsSent.mockResolvedValue();

    await markEmailsSent([5]);

    expect(entryRepoMock.markEmailsSent).toHaveBeenCalledWith([5], 2024);
  });
});
