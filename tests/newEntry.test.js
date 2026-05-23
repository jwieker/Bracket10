
import * as viewService from "../src/services/viewService.js";
import {
  EntryRepository,
  ViewRepository,
  GameRepository,
  TourneyRepository,
} from "../src/repositories/hierarchicalRepository.js";

// Mock the repository module so it doesn't trigger a real Firestore connection
vi.mock("../src/repositories/hierarchicalRepository.js");

// Create mock instances
const entryRepoMock = {
  createEntry: vi.fn().mockResolvedValue(undefined),
};

const viewRepoMock = {
  findGroupByName: vi.fn().mockImplementation((groupName) => {
    if (groupName === "Test Group") {
      return Promise.resolve("test Group: 2");
    }
    return Promise.resolve(null);
  }),
  getGroupTeams: vi.fn().mockResolvedValue([]),
};

const gameRepoMock = {
  getTournamentTeams: vi.fn().mockResolvedValue([]),
};

describe("createNewEntry function", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Re-apply mock implementations after clearAllMocks resets them
    entryRepoMock.createEntry.mockResolvedValue(undefined);
    viewRepoMock.findGroupByName.mockImplementation((groupName) => {
      if (groupName === "Test Group") return Promise.resolve("test Group: 2");
      return Promise.resolve(null);
    });
    gameRepoMock.getTournamentTeams.mockResolvedValue([]);

    // Inject mocks via setRepositories
    viewService.setRepositories(viewRepoMock, gameRepoMock, entryRepoMock);

    vi.spyOn(Date.prototype, "toISOString").mockReturnValue("2023-03-15T12:00:00.000Z");
    vi.spyOn(global.Math, "random").mockReturnValue(0.5);
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("should create a new entry with correct parameters", async () => {
    const email = "test@example.com";
    const teamName = "Test Team";
    const personName = "John Doe";
    const groupName = "Test Group";
    const picks = [73, 55, 74, 52, 72, 46, 17, 42, 49, 135];

    const expectedNewId = 1700000000000 + Math.floor(0.5 * 1000); // 1700000000500
    const expectedTimestamp = "2023-03-15T12:00:00.000Z";

    await viewService.createNewEntry(email, teamName, personName, groupName, picks);

    expect(entryRepoMock.createEntry).toHaveBeenCalledTimes(1);
    expect(entryRepoMock.createEntry).toHaveBeenCalledWith(
      expectedNewId,
      email,
      teamName,
      picks,
      groupName,
      personName,
      expectedTimestamp,
      expect.any(Number), // year
      0 // default maxPoints
    );
  });

  test("should create a new entry with explicit year and maxPoints", async () => {
    const email = "test@example.com";
    const teamName = "Test Team";
    const personName = "John Doe";
    const groupName = "Test Group";
    const picks = [73, 55, 74, 52, 72, 46, 17, 42, 49, 135];
    const explicitYear = 2025;
    const maxPoints = 150;

    const expectedNewId = 1700000000000 + Math.floor(0.5 * 1000); // 1700000000500
    const expectedTimestamp = "2023-03-15T12:00:00.000Z";

    await viewService.createNewEntry(email, teamName, personName, groupName, picks, explicitYear, maxPoints);

    expect(entryRepoMock.createEntry).toHaveBeenCalledTimes(1);
    expect(entryRepoMock.createEntry).toHaveBeenCalledWith(
      expectedNewId,
      email,
      teamName,
      picks,
      groupName,
      personName,
      expectedTimestamp,
      explicitYear,
      maxPoints
    );
  });
});

describe("verifyGroupExists function", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    viewRepoMock.findGroupByName.mockImplementation((groupName) => {
      if (groupName === "Test Group") return Promise.resolve("test Group: 2");
      return Promise.resolve(null);
    });
    gameRepoMock.getTournamentTeams.mockResolvedValue([]);

    viewService.setRepositories(viewRepoMock, gameRepoMock, entryRepoMock);
  });

  test("should return group name when group exists", async () => {
    const groupName = "Test Group";
    const expectedResult = "test Group: 2";

    const result = await viewService.verifyGroupExists(groupName);

    expect(viewRepoMock.findGroupByName).toHaveBeenCalledTimes(1);
    expect(viewRepoMock.findGroupByName).toHaveBeenCalledWith(groupName);
    expect(result).toBe(expectedResult);
  });

  test("should return null when group does not exist", async () => {
    const groupName = "Nonexistent Group";

    const result = await viewService.verifyGroupExists(groupName);

    expect(viewRepoMock.findGroupByName).toHaveBeenCalledTimes(1);
    expect(viewRepoMock.findGroupByName).toHaveBeenCalledWith(groupName);
    expect(result).toBeNull();
  });
});
