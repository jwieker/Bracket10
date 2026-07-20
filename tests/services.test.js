import {
  getFuturePoints,
  calculateEntryPointsAndPaths,
  updatePossiblePoints,
  updatePointsForAffectedEntries,
  possibleRanking,
  getTournamentData,
  setRepositories as setPointsServiceRepositories,
} from '../src/services/pointsService.js';
import {
  updateTeamRecords,
  setRepositories as setGameServiceRepositories,
} from '../src/services/gameService.js';
import {
  createNewEntry,
  verifyGroupExists,
  getGroupTeamDetails,
  getAllYearsforGroup,
  getRegionsForYear,
  findEntriesByName,
  normalizeFirstFourPicks,
  buildGameViewData,
  setRepositories as setViewServiceRepositories,
} from '../src/services/viewService.js';
import { clearAllCache, invalidateCache } from '../src/utils/cacheUtils.js';
import * as tourneyService from '../src/services/tourneyService.js';
import {
  EntryRepository,
  ViewRepository,
  GameRepository,
  TourneyRepository,
  TeamRepository,
  ConferenceRepository,
} from '../src/repositories/hierarchicalRepository.js';

// Mock the repository classes
vi.mock('../src/repositories/hierarchicalRepository.js');

describe('TourneyService', () => {
  let mockEntryRepository;
  let mockViewRepository;
  let mockGameRepository;
  let mockTourneyRepository;
  let mockTeamRepository;
  let mockConferenceRepository;

  beforeEach(() => {
    // Create mock instances
    mockEntryRepository = {
      createEntry: vi.fn(),
      updateMultipleEntryPoints: vi.fn(),
      findEntriesByName: vi.fn(),
      deleteEntry: vi.fn(),
      updateEntryPicks: vi.fn(),
      updateEntryPicksWithSwaps: vi.fn(),
    };

    mockViewRepository = {
      findGroupByName: vi.fn(),
      getGroupTeams: vi.fn(),
      getMaxGroupId: vi.fn(),
      addGroup: vi.fn(),
    };

    mockGameRepository = {
      updateWinner: vi.fn(),
      clearWinnerWithHold: vi.fn(),
      resolveGame: vi.fn(),
      undoResolvedGame: vi.fn(),
      getFirstFourGames: vi.fn(),
      updateNextGameTeam: vi.fn(),
      getActiveAndFutureGames: vi.fn(),
      getAllEntries: vi.fn(),
      getTournamentTeams: vi.fn(),
      getActiveGames: vi.fn(),
      getAllYearsForGroup: vi.fn(),
      getRegionsForYear: vi.fn(),
      getEntryById: vi.fn(),
      updateEntry: vi.fn(),
      getEntriesForGroup: vi.fn(),
      getAllTournamentDetails: vi.fn(),
      getEntriesContainingTeams: vi.fn(),
    };

    mockTourneyRepository = {
      getAllRegionTypes: vi.fn(),
      getAllRegions: vi.fn(),
      getAllTeams: vi.fn(),
      getSchoolRecordsForYear: vi.fn(),
      insertRegionsForYear: vi.fn(),
      insertMultipleGamesWithoutTeams: vi.fn(),
      insertMultipleGamesWithTeams: vi.fn(),
      insertMultipleSchoolRecords: vi.fn(),
      updateMultipleSchoolRecords: vi.fn(),
      upsertTournamentDoc: vi.fn(),
      insertFirstFourGames: vi.fn(),
      insertFirstFourSchoolRecords: vi.fn(),
      deleteGamesByYear: vi.fn(),
      deleteSchoolRecordsByYear: vi.fn(),
      deleteRegionsByYear: vi.fn(),
      deleteTournamentDoc: vi.fn(),
    };

    mockTeamRepository = {
      updateTeamRecordWithNulls: vi.fn(),
      updateTeamRecord: vi.fn(),
      createCanonicalSchoolRecord: vi.fn(),
      deleteCanonicalSchoolRecord: vi.fn(),
      getSchoolById: vi.fn(),
      updateSchool: vi.fn(),
      findSchoolsByName: vi.fn(),
      getMaxSchoolId: vi.fn(),
      insertSchool: vi.fn(),
      deleteSchool: vi.fn(),
    };

    mockConferenceRepository = {
      getAllConferences: vi.fn(),
    };

    // Mock the repository constructors
    EntryRepository.mockImplementation(() => mockEntryRepository);
    ViewRepository.mockImplementation(() => mockViewRepository);
    GameRepository.mockImplementation(() => mockGameRepository);
    TourneyRepository.mockImplementation(() => mockTourneyRepository);
    TeamRepository.mockImplementation(() => mockTeamRepository);
    ConferenceRepository.mockImplementation(() => mockConferenceRepository);

    // Inject repositories directly into services
    setPointsServiceRepositories(
      mockGameRepository,
      mockEntryRepository,
      mockTourneyRepository,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('PointsService', () => {
    describe('getFuturePoints', () => {
      test('should calculate future points for team with partial tournament', async () => {
        const futureGames = [
          ['W', 'W', 13, 15, 61, 63],
          ['W', 'W', 59, 60, 62],
          ['W', 'W', 28, 30],
        ];
        const currentPoints = 41;
        const expectedPoints = 150;

        const result = await getFuturePoints(futureGames, currentPoints);
        expect(result).toBe(expectedPoints);
      });

      test('should calculate future points for team with full tournament', async () => {
        const futureGames = [
          [46, 54, 58, 60, 62, 63],
          [23, 27, 29, 30, 61, 63],
          [6, 11, 14, 15, 61, 63],
          [4, 10, 13, 15, 61, 63],
          [33, 40, 43, 45, 62, 63],
          [50, 56, 59, 60, 62, 63],
          [37, 42, 44, 45, 62, 63],
          [17, 24, 28, 30, 61, 63],
          [35, 41, 44, 45, 62, 63],
          [18, 25, 28, 30, 61, 63],
        ];
        const currentPoints = 0;
        const expectedPoints = 193;

        const result = await getFuturePoints(futureGames, currentPoints);
        expect(result).toBe(expectedPoints);
      });

      test('should handle zero current points', async () => {
        const futureGames = [
          ['W', 'W', 13, 15],
          ['W', 'W', 59, 60],
        ];
        const currentPoints = 0;

        const result = await getFuturePoints(futureGames, currentPoints);
        expect(result).toBeGreaterThan(0);
      });

      test('should handle empty future games', async () => {
        const futureGames = [];
        const currentPoints = 50;

        const result = await getFuturePoints(futureGames, currentPoints);
        expect(result).toBe(currentPoints);
      });
    });

    describe('getTournamentData', () => {
      test('returns isNewTournament with regions when there are no active games', async () => {
        const regions = [{ regionID: 1, name: 'East' }];
        mockGameRepository.getActiveGames.mockResolvedValue([]);
        mockTourneyRepository.getAllRegionTypes.mockResolvedValue(regions);

        const result = await getTournamentData('2027');

        expect(result).toEqual({ isNewTournament: true, regions, year: 2027 });
        expect(mockTourneyRepository.getAllRegionTypes).toHaveBeenCalled();
      });

      test('returns active games without fetching regions when a tournament is live', async () => {
        const activeGames = [{ gameID: 1, team1ID: 2, team2ID: 3 }];
        mockGameRepository.getActiveGames.mockResolvedValue(activeGames);

        const result = await getTournamentData('2026');

        expect(result).toEqual({
          isNewTournament: false,
          activeGames,
          year: 2026,
        });
        expect(mockTourneyRepository.getAllRegionTypes).not.toHaveBeenCalled();
      });

      test('coerces a string year to a number before querying the repository', async () => {
        mockGameRepository.getActiveGames.mockResolvedValue([{ gameID: 1 }]);

        await getTournamentData('2026');

        expect(mockGameRepository.getActiveGames).toHaveBeenCalledWith(2026);
      });
    });

    describe('calculateEntryPointsAndPaths', () => {
      test('should calculate points and paths for entry with picks', async () => {
        const picks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const allTeams = [
          { sID: 1, points: 10, gameStatus: ['W', 'W'] },
          { sID: 2, points: 5, gameStatus: ['W', 'L'] },
        ];
        const activeGames = [
          { gameID: 1, team1ID: 1, team2ID: 2, winner: 1, nextGameID: 10 },
        ];

        const result = await calculateEntryPointsAndPaths(
          picks,
          allTeams,
          activeGames,
        );

        expect(result).toHaveProperty('currentPoints');
        expect(result).toHaveProperty('maxPoints');
        expect(result).toHaveProperty('futureGamePaths');
      });
    });

    describe('updatePossiblePoints', () => {
      test('should fetch required data, calculate, chunk, and update DB sequentially across chunks', async () => {
        // Derived from Feb26-2026_games.json
        const mockActiveGames = [
          {
            gameID: 1,
            regionID: 1,
            year: 2024,
            team1ID: 1,
            team2ID: 322,
            winner: 1,
            round: 1,
            nextGameID: 9,
            nextGameSpot: 1,
          },
          {
            gameID: 2,
            regionID: 1,
            year: 2024,
            team1ID: 92,
            team2ID: 20,
            winner: 20,
            round: 1,
            nextGameID: 9,
            nextGameSpot: 2,
          },
          {
            gameID: 61,
            regionID: 5,
            year: 2024,
            team1ID: 1,
            team2ID: 41,
            winner: 1,
            round: 5,
            nextGameID: 63,
            nextGameSpot: 1,
          },
          {
            gameID: 63,
            regionID: 6,
            year: 2024,
            team1ID: 1,
            team2ID: 23,
            winner: 1,
            round: 6,
            nextGameID: 0,
          },
        ];

        // Derived from Feb26-2026_entry.json
        const mockEntries = [
          {
            id: '1',
            year: 2024,
            teamName: 'Test Team 1',
            picks: [1, 20, 1, 1],
            group: ['Family', 'House'],
            totalPoints: 12,
            person: 'Tester 1',
            possPoints: 146,
          },
          {
            id: '2',
            year: 2024,
            teamName: 'Test Team 2',
            picks: [322, 20, 41, 23],
            group: ['Family'],
            totalPoints: 14,
            person: 'Tester 2',
            possPoints: 153,
          },
        ];

        // Derived from Feb26-2026_school.json
        const mockAllTeams = [
          {
            sID: 1,
            name: 'University of Connecticut',
            points: 10,
            gameStatus: ['W', 'W'],
          },
          { sID: 20, name: 'Northwestern', points: 5, gameStatus: ['W', 'L'] },
          {
            sID: 41,
            name: 'University of Alabama',
            points: 0,
            gameStatus: ['L'],
          },
          { sID: 23, name: 'Purdue', points: 15, gameStatus: ['W', 'W', 'L'] },
          { sID: 322, name: 'Stetson', points: 0, gameStatus: ['L'] },
          {
            sID: 92,
            name: 'Florida Atlantic University',
            points: 0,
            gameStatus: ['L'],
          },
        ];

        mockGameRepository.getActiveAndFutureGames.mockResolvedValue(
          mockActiveGames,
        );
        mockGameRepository.getAllEntries.mockResolvedValue(mockEntries);
        mockGameRepository.getTournamentTeams.mockResolvedValue(mockAllTeams);

        // Allow DB writes to resolve
        mockEntryRepository.updateMultipleEntryPoints.mockResolvedValue(true);

        // #177: the (previously ignored) group param was removed; all entries
        // for the year are always recomputed regardless.
        await updatePossiblePoints(2024);

        // Verify data fetching
        expect(mockGameRepository.getActiveAndFutureGames).toHaveBeenCalledWith(
          2024,
        );
        expect(mockGameRepository.getAllEntries).toHaveBeenCalledWith(2024);
        expect(mockGameRepository.getTournamentTeams).toHaveBeenCalledWith(
          2024,
        );

        // Verify update calls for 2 entries (should fit in first chunk depending on chunk size)
        expect(
          mockEntryRepository.updateMultipleEntryPoints,
        ).toHaveBeenCalledTimes(1);

        // Extract the first arg of the first call (which is the chunk array)
        const chunkArg =
          mockEntryRepository.updateMultipleEntryPoints.mock.calls[0][0];
        const yearArg =
          mockEntryRepository.updateMultipleEntryPoints.mock.calls[0][1];

        expect(chunkArg.length).toBe(2);
        expect(yearArg).toBe(2024);
        expect(chunkArg[0]).toHaveProperty('entryID');
        expect(chunkArg[0]).toHaveProperty('points');
        expect(chunkArg[0]).toHaveProperty('possPoints');
        // #177: dead fields removed from the update payload.
        expect(chunkArg[0]).not.toHaveProperty('futureGames');
        expect(chunkArg[0]).not.toHaveProperty('name');
        expect(chunkArg[0]).not.toHaveProperty('groupName');
      });

      test('defaults year to thisYear when called with no arguments (#158 — no ReferenceError)', async () => {
        mockGameRepository.getActiveAndFutureGames.mockResolvedValue([]);
        mockGameRepository.getAllEntries.mockResolvedValue([]);
        mockGameRepository.getTournamentTeams.mockResolvedValue([]);

        // Regression: `year = thisYear` default param previously threw
        // ReferenceError because `thisYear` was never imported. A no-arg
        // call must now resolve and use the configured current year
        // (2027 under NODE_ENV=test).
        await expect(updatePossiblePoints()).resolves.toBeUndefined();
        expect(mockGameRepository.getActiveAndFutureGames).toHaveBeenCalledWith(
          2027,
        );
      });
    });

    // #337 — the targeted recompute that runs after every ESPN poll cycle
    // (recalcPendingEntries). Previously only exercised as a vi.mock in
    // pollService.test.js; the query wiring, the empty-result early return,
    // and the 500-entry chunking loop never ran in CI.
    describe('updatePointsForAffectedEntries', () => {
      test('queries only the affected entries (not getAllEntries) and pushes one points update', async () => {
        mockGameRepository.getActiveAndFutureGames.mockResolvedValue([
          {
            gameID: 1,
            team1ID: 1,
            team2ID: 2,
            winner: null,
            round: 1,
            nextGameID: 0,
          },
        ]);
        mockGameRepository.getEntriesContainingTeams.mockResolvedValue([
          { id: '7', picks: [1] },
        ]);
        mockGameRepository.getTournamentTeams.mockResolvedValue([
          { sID: 1, points: 2, gameStatus: ['W'] },
          { sID: 2, points: 0, gameStatus: ['L'] },
        ]);
        mockEntryRepository.updateMultipleEntryPoints.mockResolvedValue(true);

        await updatePointsForAffectedEntries(2026, [1, 2]);

        // The targeted query — NOT the full-year getAllEntries scan.
        expect(
          mockGameRepository.getEntriesContainingTeams,
        ).toHaveBeenCalledWith(2026, [1, 2]);
        expect(mockGameRepository.getAllEntries).not.toHaveBeenCalled();

        expect(
          mockEntryRepository.updateMultipleEntryPoints,
        ).toHaveBeenCalledTimes(1);
        const [chunk, year] =
          mockEntryRepository.updateMultipleEntryPoints.mock.calls[0];
        expect(year).toBe(2026);
        expect(chunk).toEqual([
          { entryID: 7, points: 2, possPoints: expect.any(Number) },
        ]);
        // possPoints must at least carry the already-banked points.
        expect(chunk[0].possPoints).toBeGreaterThanOrEqual(2);
      });

      test('returns early without writing when no entries hold the affected teams', async () => {
        mockGameRepository.getActiveAndFutureGames.mockResolvedValue([]);
        mockGameRepository.getEntriesContainingTeams.mockResolvedValue([]);
        mockGameRepository.getTournamentTeams.mockResolvedValue([]);

        await updatePointsForAffectedEntries(2026, [1, 2]);

        expect(
          mockEntryRepository.updateMultipleEntryPoints,
        ).not.toHaveBeenCalled();
      });

      test('chunks 501 affected entries into two batched writes (500 + 1), both with the year', async () => {
        mockGameRepository.getActiveAndFutureGames.mockResolvedValue([]);
        mockGameRepository.getTournamentTeams.mockResolvedValue([]);
        mockGameRepository.getEntriesContainingTeams.mockResolvedValue(
          Array.from({ length: 501 }, (_, i) => ({
            id: String(i + 1),
            picks: [],
          })),
        );
        mockEntryRepository.updateMultipleEntryPoints.mockResolvedValue(true);

        await updatePointsForAffectedEntries(2026, [1]);

        expect(
          mockEntryRepository.updateMultipleEntryPoints,
        ).toHaveBeenCalledTimes(2);
        const chunkLengths =
          mockEntryRepository.updateMultipleEntryPoints.mock.calls
            .map(([chunk]) => chunk.length)
            .sort((a, b) => b - a);
        expect(chunkLengths).toEqual([500, 1]);
        for (const call of mockEntryRepository.updateMultipleEntryPoints.mock
          .calls) {
          expect(call[1]).toBe(2026);
        }
      });
    });

    describe('possibleRanking', () => {
      test('should fetch entries, calculate ranks, and sort correctly', async () => {
        const mockActiveGames = [
          {
            gameID: 1,
            regionID: 1,
            year: 2024,
            team1ID: 1,
            team2ID: 322,
            winner: 1,
            round: 1,
            nextGameID: 9,
            nextGameSpot: 1,
          },
          {
            gameID: 2,
            regionID: 1,
            year: 2024,
            team1ID: 92,
            team2ID: 20,
            winner: 20,
            round: 1,
            nextGameID: 9,
            nextGameSpot: 2,
          },
        ];

        const mockEntries = [
          {
            id: '1',
            year: 2024,
            teamName: 'Test Team 1',
            picks: [1, 20],
            group: ['Family', 'House'],
            totalPoints: 12,
            person: 'Tester 1',
            possPoints: 146,
          },
          {
            id: '2',
            year: 2024,
            teamName: 'Test Team 2',
            picks: [322, 20],
            group: ['Family'],
            totalPoints: 14,
            person: 'Tester 2',
            possPoints: 153,
          },
        ];

        const mockAllTeams = [
          {
            sID: 1,
            name: 'University of Connecticut',
            points: 10,
            gameStatus: ['W', 'W'],
          },
          { sID: 20, name: 'Northwestern', points: 5, gameStatus: ['W', 'L'] },
          { sID: 322, name: 'Stetson', points: 0, gameStatus: ['L'] },
          {
            sID: 92,
            name: 'Florida Atlantic University',
            points: 0,
            gameStatus: ['L'],
          },
        ];

        mockGameRepository.getActiveAndFutureGames.mockResolvedValue(
          mockActiveGames,
        );
        // The issue from before was because mock entries wasn't iterable on the second call. Using mockResolvedValue should persist it.
        mockGameRepository.getEntriesForGroup.mockResolvedValue(mockEntries);
        mockGameRepository.getTournamentTeams.mockResolvedValue(mockAllTeams);

        const result = await possibleRanking(2024, 'Family');

        expect(mockGameRepository.getActiveAndFutureGames).toHaveBeenCalledWith(
          2024,
        );
        expect(mockGameRepository.getEntriesForGroup).toHaveBeenCalledWith(
          2024,
          'Family',
        );
        expect(mockGameRepository.getTournamentTeams).toHaveBeenCalledWith(
          2024,
        );

        expect(result).toHaveLength(2);
        expect(result[0]).toHaveProperty('highestPlace');
        expect(result[0]).toHaveProperty('ties');
        expect(result[0]).toHaveProperty('minPoints');

        expect(result[0].highestPlace).toBeLessThanOrEqual(
          result[1].highestPlace,
        );
      });

      test('should return empty array if no entries exist', async () => {
        mockGameRepository.getActiveAndFutureGames.mockResolvedValue([]);
        mockGameRepository.getEntriesForGroup.mockResolvedValue([]);
        mockGameRepository.getTournamentTeams.mockResolvedValue([]);

        const result = await possibleRanking(2024, 'Family');

        expect(result).toEqual([]);
        expect(mockGameRepository.getEntriesForGroup).toHaveBeenCalledWith(
          2024,
          'Family',
        );
      });

      test('defaults year to thisYear when called with no arguments (#158 — no ReferenceError)', async () => {
        mockGameRepository.getActiveAndFutureGames.mockResolvedValue([]);
        mockGameRepository.getEntriesForGroup.mockResolvedValue([]);
        mockGameRepository.getTournamentTeams.mockResolvedValue([]);

        // Regression: `year = thisYear` default param previously threw
        // ReferenceError because `thisYear` was never imported.
        const result = await possibleRanking();
        expect(result).toEqual([]);
        expect(mockGameRepository.getActiveAndFutureGames).toHaveBeenCalledWith(
          2027,
        );
      });
    });
  });

  describe('ViewService', () => {
    beforeEach(() => {
      setViewServiceRepositories(
        mockViewRepository,
        mockGameRepository,
        mockEntryRepository,
      );
    });

    // #353 — proves the invalidation contract behaviorally: the key the
    // REAL buildGameViewData caches under must be evicted by the
    // `gameViewData_${year}_` prefix that every entry mutation passes to
    // invalidateCache. Uses the real in-process cache with stubbed repos,
    // so it survives refactors of the key-building code but fails on any
    // genuine key-shape drift (the #303 stale-grid class of bug).
    describe('buildGameViewData cache key contract', () => {
      test("caches under a key the year-scoped invalidation prefix evicts (and other years' prefixes don't)", async () => {
        mockGameRepository.getAllTournamentDetails.mockResolvedValue({
          activeGames: [],
          regions: [],
          teams: [],
        });
        mockViewRepository.getGroupTeams.mockResolvedValue([]);
        mockGameRepository.getAllYearsForGroup.mockResolvedValue([
          { year: 2024 },
        ]);

        clearAllCache();
        try {
          await buildGameViewData('KeyShapeGroup', 2024);

          // Warm hit: the second call must be served from the real cache.
          mockGameRepository.getAllTournamentDetails.mockClear();
          await buildGameViewData('KeyShapeGroup', 2024);
          expect(
            mockGameRepository.getAllTournamentDetails,
          ).not.toHaveBeenCalled();

          // A different year's prefix must NOT evict it…
          invalidateCache('gameViewData_2025_');
          await buildGameViewData('KeyShapeGroup', 2024);
          expect(
            mockGameRepository.getAllTournamentDetails,
          ).not.toHaveBeenCalled();

          // …but the exact prefix the entry mutations use must.
          invalidateCache('gameViewData_2024_');
          await buildGameViewData('KeyShapeGroup', 2024);
          expect(
            mockGameRepository.getAllTournamentDetails,
          ).toHaveBeenCalledTimes(1);
        } finally {
          clearAllCache(); // don't leak real-cache state into other tests
        }
      });
    });

    describe('normalizeFirstFourPicks', () => {
      // FF game 64: team1=100, team2=200. Non-FF pick 50 must pass through.
      test('unresolved FF game: either FF team normalizes to team1ID (combined convention)', async () => {
        mockGameRepository.getFirstFourGames.mockResolvedValue([
          { gameID: 64, round: 0, team1ID: 100, team2ID: 200, winner: null },
        ]);
        expect(await normalizeFirstFourPicks([100, 50], 2024)).toEqual([
          100, 50,
        ]);
        expect(await normalizeFirstFourPicks([200, 50], 2024)).toEqual([
          100, 50,
        ]);
      });

      test('resolved FF game: any FF-team pick normalizes to the winner — regardless of who was picked', async () => {
        mockGameRepository.getFirstFourGames.mockResolvedValue([
          { gameID: 64, round: 0, team1ID: 100, team2ID: 200, winner: 200 },
        ]);
        // combined pick, loser pick, and winner pick all land on the winner
        expect(await normalizeFirstFourPicks([100, 50], 2024)).toEqual([
          200, 50,
        ]);
        expect(await normalizeFirstFourPicks([200, 50], 2024)).toEqual([
          200, 50,
        ]);
      });

      test('heals a pre-existing stranded loser pick on the next edit', async () => {
        mockGameRepository.getFirstFourGames.mockResolvedValue([
          { gameID: 64, round: 0, team1ID: 100, team2ID: 200, winner: 100 },
        ]);
        expect(await normalizeFirstFourPicks([200], 2024)).toEqual([100]);
      });

      test('submitting both FF teams of one game collapses to a duplicate (caught by validation upstream)', async () => {
        mockGameRepository.getFirstFourGames.mockResolvedValue([
          { gameID: 64, round: 0, team1ID: 100, team2ID: 200, winner: null },
        ]);
        expect(await normalizeFirstFourPicks([100, 200], 2024)).toEqual([
          100, 100,
        ]);
      });

      test('multiple FF games normalize independently', async () => {
        mockGameRepository.getFirstFourGames.mockResolvedValue([
          { gameID: 64, round: 0, team1ID: 100, team2ID: 200, winner: null },
          { gameID: 65, round: 0, team1ID: 300, team2ID: 400, winner: 400 },
        ]);
        expect(await normalizeFirstFourPicks([200, 300, 50], 2024)).toEqual([
          100, 400, 50,
        ]);
      });

      test('no FF games: picks pass through untouched (new array)', async () => {
        mockGameRepository.getFirstFourGames.mockResolvedValue([]);
        const picks = [1, 2, 3];
        const result = await normalizeFirstFourPicks(picks, 2024);
        expect(result).toEqual([1, 2, 3]);
        expect(result).not.toBe(picks);
      });

      test('string-typed pick ids still match FF teams (Number coercion)', async () => {
        mockGameRepository.getFirstFourGames.mockResolvedValue([
          { gameID: 64, round: 0, team1ID: 100, team2ID: 200, winner: 200 },
        ]);
        expect(await normalizeFirstFourPicks(['100'], 2024)).toEqual([200]);
      });
    });

    describe('createNewEntry', () => {
      test('should create new entry with correct parameters', async () => {
        const email = 'test@example.com';
        const teamName = 'Test Team';
        const personName = 'John Doe';
        const groupName = 'Test Group';
        const picks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

        mockEntryRepository.createEntry.mockResolvedValue();
        mockGameRepository.getEntryById.mockResolvedValue(null); // id is free

        vi.spyOn(Date.prototype, 'toISOString').mockReturnValue(
          '2024-01-01T00:00:00.000Z',
        );

        await createNewEntry(email, teamName, personName, groupName, picks);

        expect(mockEntryRepository.createEntry).toHaveBeenCalledWith(
          expect.any(Number), // cryptographically-random id
          email,
          teamName,
          picks,
          groupName,
          personName,
          '2024-01-01T00:00:00.000Z',
          expect.any(Number), // year
          0, // default maxPoints
        );
      });

      test('should create entry with explicit year and maxPoints', async () => {
        const email = 'test@example.com';
        const teamName = 'Test Team';
        const personName = 'John Doe';
        const groupName = 'Test Group';
        const picks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const year = 2025;
        const maxPoints = 150;

        mockEntryRepository.createEntry.mockResolvedValue();
        mockGameRepository.getEntryById.mockResolvedValue(null); // id is free

        vi.spyOn(Date.prototype, 'toISOString').mockReturnValue(
          '2024-01-01T00:00:00.000Z',
        );

        await createNewEntry(
          email,
          teamName,
          personName,
          groupName,
          picks,
          year,
          maxPoints,
        );

        expect(mockEntryRepository.createEntry).toHaveBeenCalledWith(
          expect.any(Number), // cryptographically-random id
          email,
          teamName,
          picks,
          groupName,
          personName,
          '2024-01-01T00:00:00.000Z',
          year,
          maxPoints,
        );
      });
    });

    describe('verifyGroupExists', () => {
      test('should return group name when group exists', async () => {
        const groupName = 'Test Group';
        const expectedResult = 'Test Group: 1';

        mockViewRepository.findGroupByName.mockResolvedValue(expectedResult);

        const result = await verifyGroupExists(groupName);

        expect(mockViewRepository.findGroupByName).toHaveBeenCalledWith(
          groupName,
        );
        expect(result).toBe(expectedResult);
      });

      test('should return null when group does not exist', async () => {
        const groupName = 'Non-existent Group';

        mockViewRepository.findGroupByName.mockResolvedValue(null);

        const result = await verifyGroupExists(groupName);

        expect(mockViewRepository.findGroupByName).toHaveBeenCalledWith(
          groupName,
        );
        expect(result).toBeNull();
      });
    });

    describe('getGroupTeamDetails', () => {
      test('should get teams for group', async () => {
        const groupName = 'Test Group';
        const year = 2024;
        const mockTeams = [
          { id: 1, teamName: 'Team A', totalPoints: 50, picks: [1, 2] },
          { id: 2, teamName: 'Team B', totalPoints: 75, picks: [3, 4] },
        ];

        mockViewRepository.getGroupTeams.mockResolvedValue(mockTeams);
        mockGameRepository.getAllTournamentDetails.mockResolvedValue({
          teams: [],
          allGames: [],
          activeGames: [],
          regions: [],
        });

        const [mappedGroupTeams, _resultsSoFar] = await getGroupTeamDetails(
          groupName,
          year,
        );

        expect(mockViewRepository.getGroupTeams).toHaveBeenCalledWith(
          groupName,
          year,
        );
        expect(mockGameRepository.getAllTournamentDetails).toHaveBeenCalledWith(
          year,
        );
        expect(mappedGroupTeams).toEqual(
          mockTeams.map((team) => ({ ...team, pickNames: [] })),
        );
      });
    });

    describe('getAllYearsforGroup', () => {
      test('should get all years for group', async () => {
        const groupName = 'Test Group';
        const mockYears = [{ year: 2024 }, { year: 2023 }];

        mockGameRepository.getAllYearsForGroup.mockResolvedValue(mockYears);

        const result = await getAllYearsforGroup(groupName);

        expect(mockGameRepository.getAllYearsForGroup).toHaveBeenCalledWith(
          groupName,
        );
        expect(result).toEqual([2024, 2023]);
      });
    });

    describe('getRegionsForYear', () => {
      test('should get regions for year', async () => {
        const year = 2024;
        const mockDetails = {
          teams: [],
          allGames: [],
          activeGames: [],
          regions: [
            { regionID: 1, regionName: 'East' },
            { regionID: 2, regionName: 'West' },
            { regionID: 3, regionName: 'South' },
            { regionID: 4, regionName: 'Midwest' },
          ],
        };

        mockGameRepository.getAllTournamentDetails.mockResolvedValue(
          mockDetails,
        );

        const result = await getRegionsForYear(year);

        expect(mockGameRepository.getAllTournamentDetails).toHaveBeenCalledWith(
          year,
        );
        expect(result).toEqual(['East', 'West', 'South', 'Midwest']);
      });
    });

    describe('findEntriesByName', () => {
      test('should find entries by name', async () => {
        const name = 'John';
        const year = 2024;
        const mockEntries = [
          { id: 1, teamName: 'Test Team', person: 'John Doe' },
        ];

        mockEntryRepository.findEntriesByName.mockResolvedValue(mockEntries);

        const result = await findEntriesByName(name, year);

        expect(mockEntryRepository.findEntriesByName).toHaveBeenCalledWith(
          name,
          year,
        );
        expect(result).toEqual(mockEntries);
      });
    });
  });

  describe('TourneyService', () => {
    beforeEach(() => {
      tourneyService.setRepositories(
        mockTourneyRepository,
        mockGameRepository,
        mockEntryRepository,
        mockConferenceRepository,
      );
    });
    describe('createNewBracketStructure', () => {
      test('should create bracket structure correctly', async () => {
        const year = 2024;
        const regionArray = [1, 2, 3, 4];
        const games = [
          '1-1-1-1',
          '1-1-16-16',
          '1-2-8-8',
          '1-2-9-9',
          '2-16-1-2',
          '2-16-16-17',
          '2-17-8-9',
          '2-17-9-10',
        ];

        const result = await tourneyService.createNewBracketStructure(
          games,
          year,
          regionArray,
        );

        expect(result).toHaveProperty('gamesFormat');
        expect(result).toHaveProperty('teamRecordFormat');
        expect(Array.isArray(result.gamesFormat)).toBe(true);
        expect(Array.isArray(result.teamRecordFormat)).toBe(true);
      });

      test('should handle empty games array', async () => {
        const year = 2024;
        const regionArray = [1, 2, 3, 4];
        const games = [];

        const result = await tourneyService.createNewBracketStructure(
          games,
          year,
          regionArray,
        );

        expect(result.gamesFormat).toEqual([]);
        expect(result.teamRecordFormat).toEqual([]);
      });

      // S1 regression: bounds assertions for the bracket structure tables.
      test('throws ValidationError when gamesData has an odd length (R1 games come in pairs)', () => {
        expect(() =>
          tourneyService.createNewBracketStructure(
            ['1-1-1-1'],
            2024,
            [1, 2, 3, 4],
          ),
        ).toThrow(/even.*one pair per R1 game/);
      });

      test("throws ValidationError when gamesData exceeds the bracket's 32 R1-game capacity", () => {
        // 33 pairs = 66 entries, one over the bracket cap
        const oversized = Array.from(
          { length: 66 },
          (_, i) => `1-${i + 1}-1-${i + 100}`,
        );
        expect(() =>
          tourneyService.createNewBracketStructure(
            oversized,
            2024,
            [1, 2, 3, 4],
          ),
        ).toThrow(/only supports 32/);
      });
    });

    describe('createNewBracket', () => {
      beforeEach(() => {
        mockTourneyRepository.insertRegionsForYear.mockResolvedValue();
        mockTourneyRepository.insertMultipleGamesWithoutTeams.mockResolvedValue();
        mockTourneyRepository.insertMultipleGamesWithTeams.mockResolvedValue();
        mockTourneyRepository.insertMultipleSchoolRecords.mockResolvedValue();
        mockTourneyRepository.upsertTournamentDoc.mockResolvedValue();
        mockTourneyRepository.insertFirstFourGames.mockResolvedValue();
        mockTourneyRepository.insertFirstFourSchoolRecords.mockResolvedValue();
      });

      test('should create new bracket successfully', async () => {
        const year = 2024;
        const regionArray = [1, 2, 3, 4];
        const games = ['1-1-1-1', '1-1-16-16', '1-2-8-8', '1-2-9-9'];

        await tourneyService.createNewBracket(games, year, regionArray);

        expect(mockTourneyRepository.insertRegionsForYear).toHaveBeenCalled();
        expect(
          mockTourneyRepository.insertMultipleGamesWithoutTeams,
        ).toHaveBeenCalled();
        expect(
          mockTourneyRepository.insertMultipleGamesWithTeams,
        ).toHaveBeenCalled();
        expect(
          mockTourneyRepository.insertMultipleSchoolRecords,
        ).toHaveBeenCalled();
      });

      test('without FF: calls upsertTournamentDoc with no options', async () => {
        await tourneyService.createNewBracket(
          ['1-1-1-1', '1-1-16-16'],
          2024,
          [1, 2, 3, 4],
        );
        expect(mockTourneyRepository.upsertTournamentDoc).toHaveBeenCalledWith(
          2024,
        );
        expect(
          mockTourneyRepository.insertFirstFourGames,
        ).not.toHaveBeenCalled();
      });

      test('with FF: calls insertFirstFourGames and upsertTournamentDoc with hasFirstFour', async () => {
        const firstFourData = [
          {
            team1ID: 100,
            team2ID: 200,
            seed: 16,
            nextGameID: 1,
            nextGameSpot: 1,
          },
        ];

        await tourneyService.createNewBracket(
          ['1-1-1-1', '1-1-16-16'],
          2024,
          [1, 2, 3, 4],
          firstFourData,
        );

        expect(mockTourneyRepository.insertFirstFourGames).toHaveBeenCalled();
        expect(
          mockTourneyRepository.insertFirstFourSchoolRecords,
        ).toHaveBeenCalled();
        expect(mockTourneyRepository.upsertTournamentDoc).toHaveBeenCalledWith(
          2024,
          {
            hasFirstFour: true,
            firstFourGameCount: 1,
          },
        );
      });

      describe('FF-fed R1 slot: creation and winner propagation', () => {
        // Scenario: game 1 has seed-1 team (sID 10) in slot 1 and a blank slot 2 that
        // will be filled by the winner of FF game 64. The FF game has teams 100 and 200.
        // After the FF game resolves with team 100 winning, updateNextGameTeam should
        // fill slot 2 of game 1 with sID 100.
        const year = 2024;
        const regionArray = [1, 2, 3, 4];
        // Blank teamSID (empty string after the final dash) → null in createNewBracketStructure
        const gamesData = ['1-1-1-10', '1-1-16-'];
        const firstFourData = [
          {
            team1ID: 100,
            team2ID: 200,
            seed: 16,
            nextGameID: 1,
            nextGameSpot: 2,
          },
        ];

        test('R1 game with one FF-fed slot is passed to insertMultipleGamesWithTeams (not dropped)', async () => {
          await tourneyService.createNewBracket(
            gamesData,
            year,
            regionArray,
            firstFourData,
          );

          const gamesWithTeams =
            mockTourneyRepository.insertMultipleGamesWithTeams.mock.calls[0][0];
          const r1Game = gamesWithTeams.find((g) => g[0] === 1); // gameID 1
          expect(r1Game).toBeDefined();
        });

        test('FF-fed R1 slot has one real team and one null team', async () => {
          await tourneyService.createNewBracket(
            gamesData,
            year,
            regionArray,
            firstFourData,
          );

          const gamesWithTeams =
            mockTourneyRepository.insertMultipleGamesWithTeams.mock.calls[0][0];
          const r1Game = gamesWithTeams.find((g) => g[0] === 1);
          const [, , , team1ID, team2ID] = r1Game;
          expect(team1ID).toBe(10); // slot 1: real team
          expect(team2ID).toBeNull(); // slot 2: FF-fed, not yet known
        });

        test('R1 game with FF-fed slot is NOT in insertMultipleGamesWithoutTeams', async () => {
          await tourneyService.createNewBracket(
            gamesData,
            year,
            regionArray,
            firstFourData,
          );

          const gamesWithoutTeams =
            mockTourneyRepository.insertMultipleGamesWithoutTeams.mock
              .calls[0][0];
          const r1Game = gamesWithoutTeams.find((g) => g[0] === 1);
          expect(r1Game).toBeUndefined();
        });

        test('FF winner propagates into the blank R1 slot via updateTeamRecords round 0', async () => {
          // Wire up game service with a mock updateEntrywithNewSchools
          const mockUpdateEntries = vi.fn().mockResolvedValue();
          mockGameRepository.updateWinner.mockResolvedValue();
          mockGameRepository.updateNextGameTeam.mockResolvedValue();
          setGameServiceRepositories(
            mockTeamRepository,
            mockGameRepository,
            mockUpdateEntries,
          );

          // FF game 64 resolves: team 100 wins, team 200 loses
          // nextGame=1 (game 1), nextGameSpot=2 (slot 2 — the blank FF-fed slot)
          await updateTeamRecords(100, 200, 0, 64, 1, 2, year);

          expect(mockGameRepository.updateWinner).toHaveBeenCalledWith(
            64,
            100,
            year,
          );
          expect(mockGameRepository.updateNextGameTeam).toHaveBeenCalledWith(
            1,
            2,
            100,
            year,
          );
          expect(mockUpdateEntries).toHaveBeenCalledWith([[100, 200]], year);
        });
      });
    });

    describe('createFirstFourGames', () => {
      beforeEach(() => {
        mockTourneyRepository.insertFirstFourGames.mockResolvedValue();
        mockTourneyRepository.insertFirstFourSchoolRecords.mockResolvedValue();
        tourneyService.setRepositories(
          mockTourneyRepository,
          mockGameRepository,
          mockEntryRepository,
          mockConferenceRepository,
        );
      });

      test('assigns gameIDs starting at 64', async () => {
        const firstFourData = [
          {
            team1ID: 100,
            team2ID: 200,
            seed: 16,
            nextGameID: 1,
            nextGameSpot: 1,
          },
          {
            team1ID: 300,
            team2ID: 400,
            seed: 11,
            nextGameID: 2,
            nextGameSpot: 2,
          },
        ];

        await tourneyService.createFirstFourGames(
          firstFourData,
          2024,
          [1, 2, 3, 4],
        );

        const gamesArg =
          mockTourneyRepository.insertFirstFourGames.mock.calls[0][0];
        expect(gamesArg[0].gameID).toBe(64);
        expect(gamesArg[1].gameID).toBe(65);
      });

      test('sets regionID 7 and round 0 via the games passed to insertFirstFourGames', async () => {
        // The repo method sets regionID/round — verify the seed and nextGame wiring
        const firstFourData = [
          {
            team1ID: 100,
            team2ID: 200,
            seed: 11,
            nextGameID: 3,
            nextGameSpot: 2,
          },
        ];

        await tourneyService.createFirstFourGames(
          firstFourData,
          2024,
          [1, 2, 3, 4],
        );

        const gamesArg =
          mockTourneyRepository.insertFirstFourGames.mock.calls[0][0];
        expect(gamesArg[0].seed).toBe(11);
        expect(gamesArg[0].nextGameID).toBe(3);
        expect(gamesArg[0].nextGameSpot).toBe(2);
      });

      test('creates two school records per FF game with correct slots', async () => {
        const firstFourData = [
          {
            team1ID: 100,
            team2ID: 200,
            seed: 16,
            nextGameID: 1,
            nextGameSpot: 1,
          },
        ];

        await tourneyService.createFirstFourGames(
          firstFourData,
          2024,
          [1, 2, 3, 4],
        );

        const recordsArg =
          mockTourneyRepository.insertFirstFourSchoolRecords.mock.calls[0][0];
        expect(recordsArg).toHaveLength(2);
        expect(recordsArg[0]).toMatchObject({ sID: 100, slot: 1, gameID: 64 });
        expect(recordsArg[1]).toMatchObject({ sID: 200, slot: 2, gameID: 64 });
      });

      test('resolves r1RegionID from nextGameID using regionArray', async () => {
        // nextGameID=1 → games 1-8 → regionArray[0]=1 (East)
        // nextGameID=16 → games 16-23 → regionArray[1]=2 (West)
        // nextGameID=31 → games 31-38 → regionArray[2]=3 (South)
        // nextGameID=46 → games 46-53 → regionArray[3]=4 (Midwest)
        const firstFourData = [
          {
            team1ID: 100,
            team2ID: 200,
            seed: 16,
            nextGameID: 1,
            nextGameSpot: 1,
          },
          {
            team1ID: 300,
            team2ID: 400,
            seed: 11,
            nextGameID: 16,
            nextGameSpot: 2,
          },
          {
            team1ID: 500,
            team2ID: 600,
            seed: 16,
            nextGameID: 31,
            nextGameSpot: 1,
          },
          {
            team1ID: 700,
            team2ID: 800,
            seed: 11,
            nextGameID: 46,
            nextGameSpot: 2,
          },
        ];

        await tourneyService.createFirstFourGames(
          firstFourData,
          2024,
          [1, 2, 3, 4],
        );

        const recordsArg =
          mockTourneyRepository.insertFirstFourSchoolRecords.mock.calls[0][0];
        expect(recordsArg[0].r1RegionID).toBe(1); // East
        expect(recordsArg[1].r1RegionID).toBe(1); // team2 of game 0 also gets East
        expect(recordsArg[2].r1RegionID).toBe(2); // West
        expect(recordsArg[3].r1RegionID).toBe(2);
        expect(recordsArg[4].r1RegionID).toBe(3); // South
        expect(recordsArg[5].r1RegionID).toBe(3);
        expect(recordsArg[6].r1RegionID).toBe(4); // Midwest
        expect(recordsArg[7].r1RegionID).toBe(4);
      });

      test('logs warning and returns null for invalid nextGameID', async () => {
        const warnSpy = vi.spyOn(console, 'warn');
        const firstFourData = [
          {
            team1ID: 900,
            team2ID: 901,
            seed: 16,
            nextGameID: 99,
            nextGameSpot: 1,
          },
        ];

        await tourneyService.createFirstFourGames(
          firstFourData,
          2024,
          [1, 2, 3, 4],
        );

        const recordsArg =
          mockTourneyRepository.insertFirstFourSchoolRecords.mock.calls[0][0];
        expect(recordsArg[0].r1RegionID).toBeNull();
        expect(warnSpy).toHaveBeenCalled();
        const logCall = JSON.parse(warnSpy.mock.calls[0][0]);
        expect(logCall.message).toContain(
          'does not map to any R1 region range',
        );
        warnSpy.mockRestore();
      });
    });

    describe('updateBracket', () => {
      const year = 2024;
      const regionArray = [1, 2, 3, 4];

      beforeEach(() => {
        mockTourneyRepository.updateMultipleGamesWithTeams = vi
          .fn()
          .mockResolvedValue();
        mockTourneyRepository.updateMultipleSchoolRecords = vi
          .fn()
          .mockResolvedValue();
      });

      // Two R1 games across two regions: region 1 game 1 (seeds 1/16) and
      // region 2 game 16 (seeds 1/16). Existing records are listed
      // seed-sorted, exactly as getSchoolRecordsForYear returns them.
      const existingTwoRegions = [
        { sID: 10, seed: 1, regionID: 1 },
        { sID: 20, seed: 1, regionID: 2 },
        { sID: 11, seed: 16, regionID: 1 },
        { sID: 21, seed: 16, regionID: 2 },
      ];

      test('single swap pairs the new school with the removed school in its slot', async () => {
        mockTourneyRepository.getSchoolRecordsForYear.mockResolvedValue(
          existingTwoRegions,
        );

        const result = await tourneyService.updateBracket(
          ['1-1-1-10', '1-1-16-55', '2-16-1-20', '2-16-16-21'],
          year,
          regionArray,
        );

        // sID 55 replaces sID 11 in region 1 / seed 16
        expect(result).toEqual([[55, 11]]);
      });

      test('cross-slot double swap pairs each new school with the old school in the SAME region/seed slot (#336 regression)', async () => {
        mockTourneyRepository.getSchoolRecordsForYear.mockResolvedValue(
          existingTwoRegions,
        );

        // Two slots change at once: region 1 seed 16 (11 → 55) and
        // region 2 seed 1 (20 → 66). The removed schools come back
        // seed-sorted (20 before 11) while the adds are in form order
        // (55 before 66), so positional zipping produced the corrupt
        // pairs [[55, 20], [66, 11]] — migrating picks across slots.
        const result = await tourneyService.updateBracket(
          ['1-1-1-10', '1-1-16-55', '2-16-1-66', '2-16-16-21'],
          year,
          regionArray,
        );

        expect(result).toHaveLength(2);
        expect(result).toContainEqual([55, 11]);
        expect(result).toContainEqual([66, 20]);
      });

      test('pairing is independent of the order existing records are returned in', async () => {
        // Same double swap, but existing records in bracket-form order
        mockTourneyRepository.getSchoolRecordsForYear.mockResolvedValue([
          { sID: 10, seed: 1, regionID: 1 },
          { sID: 11, seed: 16, regionID: 1 },
          { sID: 20, seed: 1, regionID: 2 },
          { sID: 21, seed: 16, regionID: 2 },
        ]);

        const result = await tourneyService.updateBracket(
          ['1-1-1-10', '1-1-16-55', '2-16-1-66', '2-16-16-21'],
          year,
          regionArray,
        );

        expect(result).toHaveLength(2);
        expect(result).toContainEqual([55, 11]);
        expect(result).toContainEqual([66, 20]);
      });

      test('multi-record slot (First Four pair) pairs FIFO within the slot', async () => {
        // Both removed records share the slot key (like a First Four
        // pair feeding one R1 slot), and both replacements arrive at
        // the same key. Records in one slot carry no distinguishing
        // data, so the pairing is FIFO over each list's arrival
        // order: first add (55, form order) takes the first removed
        // record (100, getSchoolRecordsForYear order), second add
        // (66) takes the second (200).
        mockTourneyRepository.getSchoolRecordsForYear.mockResolvedValue([
          { sID: 100, seed: 16, regionID: 1 },
          { sID: 200, seed: 16, regionID: 1 },
        ]);

        const result = await tourneyService.updateBracket(
          ['1-1-16-55', '1-1-16-66'],
          year,
          regionArray,
        );

        expect(result).toEqual([
          [55, 100],
          [66, 200],
        ]);
      });

      test("throws ValidationError when a slot's removed records are exhausted mid-edit", async () => {
        // Two adds land in region 1 / seed 16 but only one removed
        // school sits there (the other removal is in seed 15). The
        // first add consumes the slot's only removed record; the
        // second must hit the exhausted-slot half of the guard and
        // fail loudly before any writes.
        mockTourneyRepository.getSchoolRecordsForYear.mockResolvedValue([
          { sID: 11, seed: 16, regionID: 1 },
          { sID: 12, seed: 15, regionID: 1 },
        ]);

        await expect(
          tourneyService.updateBracket(
            ['1-1-16-55', '1-1-16-66'],
            year,
            regionArray,
          ),
        ).rejects.toThrow(/slot mismatch.*no removed school in the same slot/);

        expect(
          mockTourneyRepository.updateMultipleSchoolRecords,
        ).not.toHaveBeenCalled();
      });

      test('throws ValidationError when a new school has no removed school in the same slot', async () => {
        // Balanced counts (one add, one remove) but different slots:
        // the new school lands in region 1 / seed 16 while the removed
        // school sat in region 1 / seed 15. Pairing them would migrate
        // picks across slots — fail loudly instead.
        mockTourneyRepository.getSchoolRecordsForYear.mockResolvedValue([
          { sID: 10, seed: 1, regionID: 1 },
          { sID: 11, seed: 15, regionID: 1 },
        ]);

        await expect(
          tourneyService.updateBracket(
            ['1-1-1-10', '1-1-16-55'],
            year,
            regionArray,
          ),
        ).rejects.toThrow(/slot mismatch.*no removed school in the same slot/);

        expect(
          mockTourneyRepository.updateMultipleSchoolRecords,
        ).not.toHaveBeenCalled();
      });

      test('throws ValidationError when more schools are removed than added (C1 regression)', async () => {
        // Empty games → newSIDs = []. Two existing → sIDsToRemove = [201, 202], sIDsToAdd = []
        mockTourneyRepository.getSchoolRecordsForYear.mockResolvedValue([
          { sID: 201 },
          { sID: 202 },
        ]);

        await expect(
          tourneyService.updateBracket([], year, regionArray),
        ).rejects.toThrow(/count mismatch.*0 additions vs 2 removals/);

        // Critically, the school-records / games writes must NOT have happened —
        // we'd rather fail loud than half-apply a structural change.
        expect(
          mockTourneyRepository.updateMultipleSchoolRecords,
        ).not.toHaveBeenCalled();
      });

      test('throws ValidationError when more schools are added than removed (C1 regression)', async () => {
        // Two new sIDs (1, 16), one existing that is also kept → sIDsToAdd = [1, 16], sIDsToRemove = []
        mockTourneyRepository.getSchoolRecordsForYear.mockResolvedValue([]);

        await expect(
          tourneyService.updateBracket(
            ['1-1-1-1', '1-1-16-16'],
            year,
            regionArray,
          ),
        ).rejects.toThrow(/count mismatch.*2 additions vs 0 removals/);
      });

      test('returns empty changes and writes nothing-new when add and remove sets are both empty', async () => {
        mockTourneyRepository.getSchoolRecordsForYear.mockResolvedValue([
          { sID: 1 },
          { sID: 16 },
        ]);

        const result = await tourneyService.updateBracket(
          ['1-1-1-1', '1-1-16-16'],
          year,
          regionArray,
        );

        expect(result).toEqual([]);
      });
    });

    describe('updateEntrywithNewSchools', () => {
      const year = 2024;

      beforeEach(() => {
        mockEntryRepository.updateEntryPicksWithSwaps = vi
          .fn()
          .mockResolvedValue();
        mockGameRepository.getEntriesContainingTeams = vi
          .fn()
          .mockResolvedValue([]);
      });

      test('passes all school changes and the affected entry ids to the repository', async () => {
        mockGameRepository.getEntriesContainingTeams.mockResolvedValue([
          { id: 1, picks: [1, 2, 3] },
        ]);

        await tourneyService.updateEntrywithNewSchools(
          [
            [101, 1],
            [202, 2],
          ],
          year,
        );

        // #388: the swap is a data-integrity write, so soft-deleted and
        // excluded-only-group entries must be included.
        expect(
          mockGameRepository.getEntriesContainingTeams,
        ).toHaveBeenCalledWith(year, [1, 2], { includeDeleted: true });
        expect(
          mockEntryRepository.updateEntryPicksWithSwaps,
        ).toHaveBeenCalledWith(
          [1],
          [
            [101, 1],
            [202, 2],
          ],
          year,
        );
      });

      test('batches all affected entries into a single repository call (#324)', async () => {
        mockGameRepository.getEntriesContainingTeams.mockResolvedValue([
          { id: 1, picks: [1, 5] },
          { id: 2, picks: [2, 6] },
          { id: 3, picks: [1, 2] },
        ]);

        await tourneyService.updateEntrywithNewSchools(
          [
            [101, 1],
            [202, 2],
          ],
          year,
        );

        expect(
          mockEntryRepository.updateEntryPicksWithSwaps,
        ).toHaveBeenCalledTimes(1);
        expect(
          mockEntryRepository.updateEntryPicksWithSwaps,
        ).toHaveBeenCalledWith(
          [1, 2, 3],
          [
            [101, 1],
            [202, 2],
          ],
          year,
        );
      });

      test('excludes falsy removeSIDs from the entry query but forwards the full change list', async () => {
        mockGameRepository.getEntriesContainingTeams.mockResolvedValue([
          { id: 1, picks: [1] },
        ]);

        await tourneyService.updateEntrywithNewSchools(
          [
            [101, null],
            [202, 1],
          ],
          year,
        );

        expect(
          mockGameRepository.getEntriesContainingTeams,
        ).toHaveBeenCalledWith(year, [1], { includeDeleted: true });
        expect(
          mockEntryRepository.updateEntryPicksWithSwaps,
        ).toHaveBeenCalledWith(
          [1],
          [
            [101, null],
            [202, 1],
          ],
          year,
        );
      });

      test('does not query entries when every removeSID is falsy', async () => {
        await tourneyService.updateEntrywithNewSchools([[101, null]], year);

        expect(
          mockGameRepository.getEntriesContainingTeams,
        ).not.toHaveBeenCalled();
        expect(
          mockEntryRepository.updateEntryPicksWithSwaps,
        ).not.toHaveBeenCalled();
      });

      test('does not write when no entries hold the removed teams', async () => {
        mockGameRepository.getEntriesContainingTeams.mockResolvedValue([]);

        await tourneyService.updateEntrywithNewSchools([[101, 1]], year);

        expect(
          mockEntryRepository.updateEntryPicksWithSwaps,
        ).not.toHaveBeenCalled();
      });
    });

    describe('getAllGames', () => {
      test('should return active and future games', async () => {
        const year = 2024;
        const mockGames = [{ gameID: 1 }, { gameID: 2 }];
        mockGameRepository.getActiveAndFutureGames.mockResolvedValue(mockGames);

        const result = await tourneyService.getAllGames(year);

        expect(mockGameRepository.getActiveAndFutureGames).toHaveBeenCalledWith(
          year,
        );
        expect(result).toEqual(mockGames);
      });
    });

    describe('deleteTournament', () => {
      test('should call repository delete methods for a given year', async () => {
        const year = 2024;
        await tourneyService.deleteTournament(year);

        expect(mockTourneyRepository.deleteGamesByYear).toHaveBeenCalledWith(
          year,
        );
        expect(
          mockTourneyRepository.deleteSchoolRecordsByYear,
        ).toHaveBeenCalledWith(year);
        expect(mockTourneyRepository.deleteRegionsByYear).toHaveBeenCalledWith(
          year,
        );
        expect(mockTourneyRepository.deleteTournamentDoc).toHaveBeenCalledWith(
          year,
        );
      });
    });

    describe('prepareNewTournamentData', () => {
      test('should fetch structured data and filter bracket regions correctly', async () => {
        const mockRegionTypes = [
          { regionID: 1, name: 'East' },
          { regionID: 4, name: 'West' },
          { regionID: 5, name: 'Final Four' },
          { regionID: 6, name: 'Championship' },
        ];
        const mockTeams = [{ sid: 1, name: 'Team 1' }];
        const mockConferences = [{ slug: 'conf', name: 'Conference' }];

        mockTourneyRepository.getAllRegionTypes.mockResolvedValue(
          mockRegionTypes,
        );
        mockTourneyRepository.getAllTeams.mockResolvedValue(mockTeams);
        mockConferenceRepository.getAllConferences.mockResolvedValue(
          mockConferences,
        );

        const result = await tourneyService.prepareNewTournamentData();

        expect(mockTourneyRepository.getAllRegionTypes).toHaveBeenCalled();
        expect(mockTourneyRepository.getAllTeams).toHaveBeenCalled();
        expect(mockConferenceRepository.getAllConferences).toHaveBeenCalled();

        expect(result).toHaveProperty('allRegionTypes');
        expect(result.allRegionTypes).toHaveLength(2);
        expect(result.allRegionTypes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ regionID: 1 }),
            expect.objectContaining({ regionID: 4 }),
          ]),
        );
        expect(result).toHaveProperty('allTeams', mockTeams);
        expect(result).toHaveProperty('conferences', mockConferences);
        expect(result).toHaveProperty(
          'seeds',
          [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15],
        );
      });
    });

    describe('prepareRegionVerifyData', () => {
      test('should prepare region verify data correctly', async () => {
        const regions = [1, 2, 3, 4];
        const mockRegions = [
          { regionID: 1, regionName: 'East' },
          { regionID: 2, regionName: 'West' },
          { regionID: 3, regionName: 'South' },
          { regionID: 4, regionName: 'Midwest' },
        ];
        const mockTeams = [
          { sid: 1, name: 'Team A' },
          { sid: 2, name: 'Team B' },
        ];

        mockTourneyRepository.getAllRegionTypes.mockResolvedValue(mockRegions);
        mockTourneyRepository.getAllTeams.mockResolvedValue(mockTeams);
        mockConferenceRepository.getAllConferences.mockResolvedValue([]);

        const year = 2026;
        const result = await tourneyService.prepareRegionVerifyData(
          regions,
          year,
        );

        expect(result).toHaveProperty('regions', regions);
        expect(result).toHaveProperty('regionNames');
        expect(result).toHaveProperty('allTeams', mockTeams);
        expect(result).toHaveProperty('seeds');
        expect(mockTourneyRepository.getAllRegionTypes).toHaveBeenCalled();
        expect(mockTourneyRepository.getAllTeams).toHaveBeenCalled();
      });
    });
  });
});
