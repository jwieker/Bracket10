import * as viewService from '../src/services/viewService.js';

// Mock the repository module so it doesn't trigger a real Firestore connection
vi.mock('../src/repositories/hierarchicalRepository.js');

// Create mock instances
const entryRepoMock = {
  createEntry: vi.fn().mockResolvedValue(undefined),
};

const viewRepoMock = {
  findGroupByName: vi.fn().mockImplementation((groupName) => {
    if (groupName === 'Test Group') {
      return Promise.resolve('test Group: 2');
    }
    return Promise.resolve(null);
  }),
  getGroupTeams: vi.fn().mockResolvedValue([]),
};

const gameRepoMock = {
  getTournamentTeams: vi.fn().mockResolvedValue([]),
  // createNewEntry checks that a freshly-generated random id is unused before
  // writing. Default to "free" (null); individual tests override for collisions.
  getEntryById: vi.fn().mockResolvedValue(null),
};

describe('createNewEntry function', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Re-apply mock implementations after clearAllMocks resets them
    entryRepoMock.createEntry.mockResolvedValue(undefined);
    viewRepoMock.findGroupByName.mockImplementation((groupName) => {
      if (groupName === 'Test Group') return Promise.resolve('test Group: 2');
      return Promise.resolve(null);
    });
    gameRepoMock.getTournamentTeams.mockResolvedValue([]);
    gameRepoMock.getEntryById.mockResolvedValue(null);

    // Inject mocks via setRepositories
    viewService.setRepositories(viewRepoMock, gameRepoMock, entryRepoMock);

    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue(
      '2023-03-15T12:00:00.000Z',
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('should create a new entry with correct parameters', async () => {
    const email = 'test@example.com';
    const teamName = 'Test Team';
    const personName = 'John Doe';
    const groupName = 'Test Group';
    const picks = [73, 55, 74, 52, 72, 46, 17, 42, 49, 135];

    const expectedTimestamp = '2023-03-15T12:00:00.000Z';

    await viewService.createNewEntry(
      email,
      teamName,
      personName,
      groupName,
      picks,
    );

    expect(entryRepoMock.createEntry).toHaveBeenCalledTimes(1);
    expect(entryRepoMock.createEntry).toHaveBeenCalledWith(
      expect.any(Number), // cryptographically-random id
      email,
      teamName,
      picks,
      groupName,
      personName,
      expectedTimestamp,
      expect.any(Number), // year
      0, // default maxPoints
    );

    // Id should be a large random integer, not a timestamp-derived value.
    const generatedId = entryRepoMock.createEntry.mock.calls[0][0];
    expect(Number.isInteger(generatedId)).toBe(true);
    expect(generatedId).toBeGreaterThanOrEqual(100_000_000_000);
    expect(generatedId).toBeLessThan(281_474_976_710_655);
    // The id is checked for uniqueness before being used.
    expect(gameRepoMock.getEntryById).toHaveBeenCalledWith(
      generatedId,
      expect.any(Number),
    );
  });

  test('should retry id generation when the first random id collides', async () => {
    const email = 'test@example.com';
    const picks = [73, 55, 74, 52, 72, 46, 17, 42, 49, 135];

    // First candidate already exists, second is free.
    gameRepoMock.getEntryById
      .mockResolvedValueOnce({ id: 123, email: 'other@example.com' })
      .mockResolvedValueOnce(null);

    await viewService.createNewEntry(
      email,
      'Test Team',
      'John Doe',
      'Test Group',
      picks,
    );

    expect(gameRepoMock.getEntryById).toHaveBeenCalledTimes(2);
    expect(entryRepoMock.createEntry).toHaveBeenCalledTimes(1);
    const usedId = entryRepoMock.createEntry.mock.calls[0][0];
    const firstCandidate = gameRepoMock.getEntryById.mock.calls[0][0];
    // The colliding candidate must not have been used.
    expect(usedId).not.toBe(firstCandidate);
  });

  test('should create a new entry with explicit year and maxPoints', async () => {
    const email = 'test@example.com';
    const teamName = 'Test Team';
    const personName = 'John Doe';
    const groupName = 'Test Group';
    const picks = [73, 55, 74, 52, 72, 46, 17, 42, 49, 135];
    const explicitYear = 2025;
    const maxPoints = 150;

    const expectedTimestamp = '2023-03-15T12:00:00.000Z';

    await viewService.createNewEntry(
      email,
      teamName,
      personName,
      groupName,
      picks,
      explicitYear,
      maxPoints,
    );

    expect(entryRepoMock.createEntry).toHaveBeenCalledTimes(1);
    expect(entryRepoMock.createEntry).toHaveBeenCalledWith(
      expect.any(Number), // cryptographically-random id
      email,
      teamName,
      picks,
      groupName,
      personName,
      expectedTimestamp,
      explicitYear,
      maxPoints,
    );
  });

  test('normalizes the email (trim + lowercase) before storing', async () => {
    const picks = [73, 55, 74, 52, 72, 46, 17, 42, 49, 135];

    await viewService.createNewEntry(
      '  John@Gmail.COM ',
      'Test Team',
      'John Doe',
      'Test Group',
      picks,
    );

    // Stored canonicalized so it matches the lowercased session email used by
    // getEntriesByEmail / ownership checks in the "My Brackets" flow.
    expect(entryRepoMock.createEntry).toHaveBeenCalledWith(
      expect.any(Number),
      'john@gmail.com',
      'Test Team',
      picks,
      'Test Group',
      'John Doe',
      expect.any(String),
      expect.any(Number),
      0,
    );
  });
});

describe('verifyGroupExists function', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    viewRepoMock.findGroupByName.mockImplementation((groupName) => {
      if (groupName === 'Test Group') return Promise.resolve('test Group: 2');
      return Promise.resolve(null);
    });
    gameRepoMock.getTournamentTeams.mockResolvedValue([]);

    viewService.setRepositories(viewRepoMock, gameRepoMock, entryRepoMock);
  });

  test('should return group name when group exists', async () => {
    const groupName = 'Test Group';
    const expectedResult = 'test Group: 2';

    const result = await viewService.verifyGroupExists(groupName);

    expect(viewRepoMock.findGroupByName).toHaveBeenCalledTimes(1);
    expect(viewRepoMock.findGroupByName).toHaveBeenCalledWith(groupName);
    expect(result).toBe(expectedResult);
  });

  test('should return null when group does not exist', async () => {
    const groupName = 'Nonexistent Group';

    const result = await viewService.verifyGroupExists(groupName);

    expect(viewRepoMock.findGroupByName).toHaveBeenCalledTimes(1);
    expect(viewRepoMock.findGroupByName).toHaveBeenCalledWith(groupName);
    expect(result).toBeNull();
  });
});
