import { getUnsentEmailEntries, markEmailsSent } from '../src/services/emailService.js';

// `vi.hoisted` lets us share mock state with the hoisted `vi.mock` factory
// without tripping the "cannot access before initialization" TDZ error.
const { entryRepoMock, collectionMock } = vi.hoisted(() => ({
  entryRepoMock: {
    getUnsentEmailEntries: vi.fn(),
    markEmailsSent: vi.fn(),
  },
  collectionMock: vi.fn(),
}));

vi.mock('../src/repositories/index.js', () => ({
  entryRepository: entryRepoMock,
}));

vi.mock('../src/config/firestore.js', () => ({
  db: { collection: (...args) => collectionMock(...args) },
}));

vi.mock('../src/config/app.js', () => ({
  thisYear: 2024,
  APP_CONFIG: {
    tournament: { emailGroup: 'EmailList' },
  },
}));

// Builds a chainable mock that lets us assert path navigation and inject docs.
function mockSchoolRecordsSnap(docs) {
  const snap = { docs: docs.map((d) => ({ data: () => d })) };
  const getFn = vi.fn().mockResolvedValue(snap);
  const subCol = { get: getFn };
  const yearDoc = { collection: vi.fn().mockReturnValue(subCol) };
  const tournDoc = vi.fn().mockReturnValue(yearDoc);
  const tournCol = { doc: tournDoc };
  collectionMock.mockReturnValue(tournCol);
  return { tournDoc, yearDoc, getFn };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getUnsentEmailEntries', () => {
  test('joins entries with team names from schoolRecords using nameNick by preference', async () => {
    entryRepoMock.getUnsentEmailEntries.mockResolvedValue([
      { id: 1, picks: [101, 202] },
      { id: 2, picks: [101] },
    ]);
    mockSchoolRecordsSnap([
      { sID: 101, nameNick: 'Devils', schoolName: 'Duke' },
      { sID: 202, schoolName: 'Kansas' }, // no nameNick → fall through to schoolName
    ]);

    const result = await getUnsentEmailEntries(2024);

    expect(result).toEqual([
      { id: 1, picks: [101, 202], pickNames: ['Devils', 'Kansas'] },
      { id: 2, picks: [101], pickNames: ['Devils'] },
    ]);
  });

  test('queries the configured EMAIL_GROUP from the entry repository', async () => {
    entryRepoMock.getUnsentEmailEntries.mockResolvedValue([]);
    mockSchoolRecordsSnap([]);

    await getUnsentEmailEntries(2024);

    expect(entryRepoMock.getUnsentEmailEntries).toHaveBeenCalledWith('EmailList', 2024);
  });

  test('navigates the tournaments/{year}/schoolRecords path correctly', async () => {
    entryRepoMock.getUnsentEmailEntries.mockResolvedValue([]);
    const { tournDoc, yearDoc } = mockSchoolRecordsSnap([]);

    await getUnsentEmailEntries(2024);

    expect(collectionMock).toHaveBeenCalledWith('tournaments');
    expect(tournDoc).toHaveBeenCalledWith('2024');
    expect(yearDoc.collection).toHaveBeenCalledWith('schoolRecords');
  });

  test('defaults year to thisYear (2024) when omitted', async () => {
    entryRepoMock.getUnsentEmailEntries.mockResolvedValue([]);
    const { tournDoc } = mockSchoolRecordsSnap([]);

    await getUnsentEmailEntries();

    expect(entryRepoMock.getUnsentEmailEntries).toHaveBeenCalledWith('EmailList', 2024);
    expect(tournDoc).toHaveBeenCalledWith('2024');
  });

  test('falls back to "Team {sID}" when a pick has no matching schoolRecord at all', async () => {
    entryRepoMock.getUnsentEmailEntries.mockResolvedValue([
      { id: 1, picks: [999] },
    ]);
    mockSchoolRecordsSnap([]); // no school records loaded

    const result = await getUnsentEmailEntries(2024);

    expect(result[0].pickNames).toEqual(['Team 999']);
  });

  test('falls back to "Team {sID}" when the schoolRecord has neither nameNick nor schoolName', async () => {
    entryRepoMock.getUnsentEmailEntries.mockResolvedValue([
      { id: 1, picks: [101] },
    ]);
    mockSchoolRecordsSnap([{ sID: 101 }]);

    const result = await getUnsentEmailEntries(2024);

    expect(result[0].pickNames).toEqual(['Team 101']);
  });

  test('handles an entry with no picks field by treating it as empty array', async () => {
    entryRepoMock.getUnsentEmailEntries.mockResolvedValue([{ id: 1 }]);
    mockSchoolRecordsSnap([]);

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
