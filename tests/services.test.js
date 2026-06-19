
import {
    getFuturePoints,
    calculateEntryPointsAndPaths,
    updatePossiblePoints,
    possibleRanking,
    setRepositories as setPointsServiceRepositories,
} from "../src/services/pointsService.js";
import {
    updateTeamRecords,
    undoTeamRecords,
    setRepositories as setGameServiceRepositories,
} from "../src/services/gameService.js";
import {
    createNewEntry,
    verifyGroupExists,
    getGroupTeamDetails,
    getAllYearsforGroup,
    getRegionsForYear,
    findEntriesByName,
    normalizeFirstFourPicks,
    setRepositories as setViewServiceRepositories,
} from "../src/services/viewService.js";
import * as tourneyService from "../src/services/tourneyService.js";
import {
    EntryRepository,
    ViewRepository,
    GameRepository,
    TourneyRepository,
    TeamRepository,
    ConferenceRepository,
} from "../src/repositories/hierarchicalRepository.js";

// Mock the repository classes
vi.mock("../src/repositories/hierarchicalRepository.js");

describe("TourneyService", () => {
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
            getAllEntries: vi.fn(),
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
        setPointsServiceRepositories(mockGameRepository, mockEntryRepository, mockTourneyRepository);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("PointsService", () => {
        describe("getFuturePoints", () => {
            test("should calculate future points for team with partial tournament", async () => {
                const futureGames = [
                    ["W", "W", 13, 15, 61, 63],
                    ["W", "W", 59, 60, 62],
                    ["W", "W", 28, 30],
                ];
                const currentPoints = 41;
                const expectedPoints = 150;

                const result = await getFuturePoints(futureGames, currentPoints);
                expect(result).toBe(expectedPoints);
            });

            test("should calculate future points for team with full tournament", async () => {
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

            test("should handle zero current points", async () => {
                const futureGames = [
                    ["W", "W", 13, 15],
                    ["W", "W", 59, 60],
                ];
                const currentPoints = 0;

                const result = await getFuturePoints(futureGames, currentPoints);
                expect(result).toBeGreaterThan(0);
            });

            test("should handle empty future games", async () => {
                const futureGames = [];
                const currentPoints = 50;

                const result = await getFuturePoints(futureGames, currentPoints);
                expect(result).toBe(currentPoints);
            });
        });

        describe("calculateEntryPointsAndPaths", () => {
            test("should calculate points and paths for entry with picks", async () => {
                const picks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
                const allTeams = [
                    { sID: 1, points: 10, gameStatus: ["W", "W"] },
                    { sID: 2, points: 5, gameStatus: ["W", "L"] },
                ];
                const activeGames = [
                    { gameID: 1, team1ID: 1, team2ID: 2, winner: 1, nextGameID: 10 },
                ];

                const result = await calculateEntryPointsAndPaths(
                    picks,
                    allTeams,
                    activeGames
                );

                expect(result).toHaveProperty("currentPoints");
                expect(result).toHaveProperty("maxPoints");
                expect(result).toHaveProperty("futureGamePaths");
            });
        });

        describe("updatePossiblePoints", () => {
            test("should fetch required data, calculate, chunk, and update DB sequentially across chunks", async () => {
                // Derived from Feb26-2026_games.json
                const mockActiveGames = [
                    { gameID: 1, regionID: 1, year: 2024, team1ID: 1, team2ID: 322, winner: 1, round: 1, nextGameID: 9, nextGameSpot: 1 },
                    { gameID: 2, regionID: 1, year: 2024, team1ID: 92, team2ID: 20, winner: 20, round: 1, nextGameID: 9, nextGameSpot: 2 },
                    { gameID: 61, regionID: 5, year: 2024, team1ID: 1, team2ID: 41, winner: 1, round: 5, nextGameID: 63, nextGameSpot: 1 },
                    { gameID: 63, regionID: 6, year: 2024, team1ID: 1, team2ID: 23, winner: 1, round: 6, nextGameID: 0 }
                ];

                // Derived from Feb26-2026_entry.json
                const mockEntries = [
                    { id: "1", year: 2024, teamName: "Test Team 1", picks: [1, 20, 1, 1], group: ["Family", "House"], totalPoints: 12, person: "Tester 1", possPoints: 146 },
                    { id: "2", year: 2024, teamName: "Test Team 2", picks: [322, 20, 41, 23], group: ["Family"], totalPoints: 14, person: "Tester 2", possPoints: 153 }
                ];

                // Derived from Feb26-2026_school.json
                const mockAllTeams = [
                    { sID: 1, name: "University of Connecticut", points: 10, gameStatus: ["W", "W"] },
                    { sID: 20, name: "Northwestern", points: 5, gameStatus: ["W", "L"] },
                    { sID: 41, name: "University of Alabama", points: 0, gameStatus: ["L"] },
                    { sID: 23, name: "Purdue", points: 15, gameStatus: ["W", "W", "L"] },
                    { sID: 322, name: "Stetson", points: 0, gameStatus: ["L"] },
                    { sID: 92, name: "Florida Atlantic University", points: 0, "gameStatus": ["L"] }
                ];

                mockGameRepository.getActiveAndFutureGames.mockResolvedValue(mockActiveGames);
                mockGameRepository.getAllEntries.mockResolvedValue(mockEntries);
                mockGameRepository.getTournamentTeams.mockResolvedValue(mockAllTeams);

                // Allow DB writes to resolve
                mockEntryRepository.updateMultipleEntryPoints.mockResolvedValue(true);

                await updatePossiblePoints(2024, "Family");

                // Verify data fetching
                expect(mockGameRepository.getActiveAndFutureGames).toHaveBeenCalledWith(2024);
                expect(mockGameRepository.getAllEntries).toHaveBeenCalledWith(2024);
                expect(mockGameRepository.getTournamentTeams).toHaveBeenCalledWith(2024);

                // Verify update calls for 2 entries (should fit in first chunk depending on chunk size)
                expect(mockEntryRepository.updateMultipleEntryPoints).toHaveBeenCalledTimes(1);

                // Extract the first arg of the first call (which is the chunk array)
                const chunkArg = mockEntryRepository.updateMultipleEntryPoints.mock.calls[0][0];
                const yearArg = mockEntryRepository.updateMultipleEntryPoints.mock.calls[0][1];

                expect(chunkArg.length).toBe(2);
                expect(yearArg).toBe(2024);
                expect(chunkArg[0]).toHaveProperty("entryID");
                expect(chunkArg[0]).toHaveProperty("points");
                expect(chunkArg[0]).toHaveProperty("possPoints");
            });

            test("defaults year to thisYear when called with no arguments (#158 — no ReferenceError)", async () => {
                mockGameRepository.getActiveAndFutureGames.mockResolvedValue([]);
                mockGameRepository.getAllEntries.mockResolvedValue([]);
                mockGameRepository.getTournamentTeams.mockResolvedValue([]);

                // Regression: `year = thisYear` default param previously threw
                // ReferenceError because `thisYear` was never imported. A no-arg
                // call must now resolve and use the configured current year
                // (2027 under NODE_ENV=test).
                await expect(updatePossiblePoints()).resolves.toBeUndefined();
                expect(mockGameRepository.getActiveAndFutureGames).toHaveBeenCalledWith(2027);
            });
        });

        describe("possibleRanking", () => {
            test("should fetch entries, calculate ranks, and sort correctly", async () => {
                const mockActiveGames = [
                    { gameID: 1, regionID: 1, year: 2024, team1ID: 1, team2ID: 322, winner: 1, round: 1, nextGameID: 9, nextGameSpot: 1 },
                    { gameID: 2, regionID: 1, year: 2024, team1ID: 92, team2ID: 20, winner: 20, round: 1, nextGameID: 9, nextGameSpot: 2 }
                ];

                const mockEntries = [
                    { id: "1", year: 2024, teamName: "Test Team 1", picks: [1, 20], group: ["Family", "House"], totalPoints: 12, person: "Tester 1", possPoints: 146 },
                    { id: "2", year: 2024, teamName: "Test Team 2", picks: [322, 20], group: ["Family"], totalPoints: 14, person: "Tester 2", possPoints: 153 }
                ];

                const mockAllTeams = [
                    { sID: 1, name: "University of Connecticut", points: 10, gameStatus: ["W", "W"] },
                    { sID: 20, name: "Northwestern", points: 5, gameStatus: ["W", "L"] },
                    { sID: 322, name: "Stetson", points: 0, gameStatus: ["L"] },
                    { sID: 92, name: "Florida Atlantic University", points: 0, gameStatus: ["L"] }
                ];

                mockGameRepository.getActiveAndFutureGames.mockResolvedValue(mockActiveGames);
                // The issue from before was because mock entries wasn't iterable on the second call. Using mockResolvedValue should persist it.
                mockGameRepository.getEntriesForGroup.mockResolvedValue(mockEntries);
                mockGameRepository.getTournamentTeams.mockResolvedValue(mockAllTeams);

                const result = await possibleRanking(2024, "Family");

                expect(mockGameRepository.getActiveAndFutureGames).toHaveBeenCalledWith(2024);
                expect(mockGameRepository.getEntriesForGroup).toHaveBeenCalledWith(2024, "Family");
                expect(mockGameRepository.getTournamentTeams).toHaveBeenCalledWith(2024);

                expect(result).toHaveLength(2);
                expect(result[0]).toHaveProperty("highestPlace");
                expect(result[0]).toHaveProperty("ties");
                expect(result[0]).toHaveProperty("minPoints");

                expect(result[0].highestPlace).toBeLessThanOrEqual(result[1].highestPlace);
            });

            test("should return empty array if no entries exist", async () => {
                mockGameRepository.getActiveAndFutureGames.mockResolvedValue([]);
                mockGameRepository.getEntriesForGroup.mockResolvedValue([]);
                mockGameRepository.getTournamentTeams.mockResolvedValue([]);

                const result = await possibleRanking(2024, "Family");

                expect(result).toEqual([]);
                expect(mockGameRepository.getEntriesForGroup).toHaveBeenCalledWith(2024, "Family");
            });

            test("defaults year to thisYear when called with no arguments (#158 — no ReferenceError)", async () => {
                mockGameRepository.getActiveAndFutureGames.mockResolvedValue([]);
                mockGameRepository.getEntriesForGroup.mockResolvedValue([]);
                mockGameRepository.getTournamentTeams.mockResolvedValue([]);

                // Regression: `year = thisYear` default param previously threw
                // ReferenceError because `thisYear` was never imported.
                const result = await possibleRanking();
                expect(result).toEqual([]);
                expect(mockGameRepository.getActiveAndFutureGames).toHaveBeenCalledWith(2027);
            });
        });
    });

    describe("GameService", () => {
        beforeEach(() => {
            setGameServiceRepositories(mockTeamRepository, mockGameRepository);
        });
        describe("updateTeamRecords", () => {
            test("resolves the game in a single transactional repo call", async () => {
                mockGameRepository.resolveGame.mockResolvedValue();

                await updateTeamRecords(1, 2, 2, 10, 20, 1, 2024);

                expect(mockGameRepository.resolveGame).toHaveBeenCalledTimes(1);
                expect(mockGameRepository.resolveGame).toHaveBeenCalledWith(
                    expect.objectContaining({
                        gameID: 10,
                        winner: 1,
                        loser: 2,
                        nextGame: 20,
                        nextGameSpot: 1,
                        winnerPoints: expect.any(Number),
                        winnerStatus: expect.any(Array),
                        loserPoints: expect.any(Number),
                        loserStatus: expect.any(Array),
                    }),
                    2024
                );
                // No piecemeal writes outside the transaction
                expect(mockGameRepository.updateWinner).not.toHaveBeenCalled();
                expect(mockGameRepository.updateNextGameTeam).not.toHaveBeenCalled();
                expect(mockTeamRepository.updateTeamRecord).not.toHaveBeenCalled();
            });

            test("should handle championship game (no next game)", async () => {
                mockGameRepository.resolveGame.mockResolvedValue();

                await updateTeamRecords(1, 2, 6, 63, 0, null, 2024);

                expect(mockGameRepository.resolveGame).toHaveBeenCalledWith(
                    expect.objectContaining({ gameID: 63, winner: 1, loser: 2, nextGame: null }),
                    2024
                );
            });

            test("propagates a transaction failure to the caller", async () => {
                mockGameRepository.resolveGame.mockRejectedValue(new Error("txn aborted"));

                await expect(updateTeamRecords(1, 2, 2, 10, 20, 1, 2024)).rejects.toThrow("txn aborted");
            });
        });

        describe("undoTeamRecords", () => {
            test("round 1 undo restores both teams to pre-tournament state (nulls) in one transactional call", async () => {
                mockGameRepository.undoResolvedGame.mockResolvedValue();

                await undoTeamRecords(1, 2, 1, 10, 20, 1, 2024);

                expect(mockGameRepository.undoResolvedGame).toHaveBeenCalledTimes(1);
                expect(mockGameRepository.undoResolvedGame).toHaveBeenCalledWith(
                    expect.objectContaining({
                        gameID: 10,
                        winner: 1,
                        loser: 2,
                        nextGame: 20,
                        nextGameSpot: 1,
                        restorePoints: null,
                        restoreStatus: [],
                    }),
                    2024
                );
                // No piecemeal writes outside the transaction
                expect(mockGameRepository.clearWinnerWithHold).not.toHaveBeenCalled();
                expect(mockGameRepository.updateWinner).not.toHaveBeenCalled();
                expect(mockGameRepository.updateNextGameTeam).not.toHaveBeenCalled();
                expect(mockTeamRepository.updateTeamRecord).not.toHaveBeenCalled();
                expect(mockTeamRepository.updateTeamRecordWithNulls).not.toHaveBeenCalled();
            });

            test("round 1 undo with no nextGame passes nextGame: null", async () => {
                mockGameRepository.undoResolvedGame.mockResolvedValue();
                await undoTeamRecords(1, 2, 1, 10, null, null, 2024);
                expect(mockGameRepository.undoResolvedGame).toHaveBeenCalledWith(
                    expect.objectContaining({ gameID: 10, nextGame: null }),
                    2024
                );
            });

            test("round 2 undo restores both teams to their Round-1-winner state", async () => {
                // config.wins=2, so restoreStatus = ["W"] (one prior win), restorePoints = loserPoints = 2
                mockGameRepository.undoResolvedGame.mockResolvedValue();

                await undoTeamRecords(1, 2, 2, 10, 20, 1, 2024);

                expect(mockGameRepository.undoResolvedGame).toHaveBeenCalledWith(
                    expect.objectContaining({ restorePoints: 2, restoreStatus: ["W"] }),
                    2024
                );
            });

            test("round 3 undo: restoreStatus has 2 Ws (config.wins - 1 = 2)", async () => {
                mockGameRepository.undoResolvedGame.mockResolvedValue();

                await undoTeamRecords(1, 2, 3, 13, 15, 1, 2024);

                expect(mockGameRepository.undoResolvedGame).toHaveBeenCalledWith(
                    expect.objectContaining({ restorePoints: 5, restoreStatus: ["W", "W"] }),
                    2024
                );
            });

            test("round 2+ undo with no nextGame passes nextGame: null", async () => {
                mockGameRepository.undoResolvedGame.mockResolvedValue();

                await undoTeamRecords(1, 2, 2, 10, null, null, 2024);

                expect(mockGameRepository.undoResolvedGame).toHaveBeenCalledWith(
                    expect.objectContaining({ nextGame: null }),
                    2024
                );
            });

            test("propagates a transaction failure to the caller", async () => {
                mockGameRepository.undoResolvedGame.mockRejectedValue(new Error("txn aborted"));
                await expect(undoTeamRecords(1, 2, 2, 10, 20, 1, 2024)).rejects.toThrow("txn aborted");
            });

            test("throws on invalid round number", async () => {
                await expect(undoTeamRecords(1, 2, 99, 10, null, null, 2024))
                    .rejects.toThrow("Invalid round number: 99");
            });
        });

        describe("updateTeamRecords — exact arrays per round", () => {
            beforeEach(() => {
                mockGameRepository.resolveGame.mockResolvedValue();
            });

            test("round 1: winner gets ['W'], loser gets ['L']", async () => {
                await updateTeamRecords(1, 2, 1, 5, 9, 1, 2024);
                expect(mockGameRepository.resolveGame).toHaveBeenCalledWith(
                    expect.objectContaining({
                        winnerPoints: 2, winnerStatus: ["W"],
                        loserPoints: 0, loserStatus: ["L"],
                    }),
                    2024
                );
            });

            test("round 2: winner gets ['W','W'], loser gets ['W','L']", async () => {
                await updateTeamRecords(1, 2, 2, 9, 13, 1, 2024);
                expect(mockGameRepository.resolveGame).toHaveBeenCalledWith(
                    expect.objectContaining({
                        winnerPoints: 5, winnerStatus: ["W", "W"],
                        loserPoints: 2, loserStatus: ["W", "L"],
                    }),
                    2024
                );
            });

            test("round 6: winner gets 6 Ws, loser gets 5 Ws then L", async () => {
                await updateTeamRecords(1, 2, 6, 63, 0, null, 2024);
                expect(mockGameRepository.resolveGame).toHaveBeenCalledWith(
                    expect.objectContaining({
                        winnerPoints: 69, winnerStatus: ["W", "W", "W", "W", "W", "W"],
                        loserPoints: 36, loserStatus: ["W", "W", "W", "W", "W", "L"],
                    }),
                    2024
                );
            });

            test("passes nextGame: null when nextGame is falsy", async () => {
                await updateTeamRecords(1, 2, 6, 63, 0, null, 2024);
                expect(mockGameRepository.resolveGame).toHaveBeenCalledWith(
                    expect.objectContaining({ nextGame: null }),
                    2024
                );
            });

            test("throws on invalid round number", async () => {
                await expect(updateTeamRecords(1, 2, 99, 5, 9, 1, 2024))
                    .rejects.toThrow("Invalid tournament round: 99");
            });
        });

        describe("round 0 — First Four", () => {
            let mockUpdateEntrywithNewSchools;

            beforeEach(() => {
                mockUpdateEntrywithNewSchools = vi.fn().mockResolvedValue();
                mockGameRepository.updateWinner.mockResolvedValue();
                mockGameRepository.clearWinnerWithHold.mockResolvedValue();
                mockGameRepository.getFirstFourGames.mockResolvedValue([]);
                mockGameRepository.updateNextGameTeam.mockResolvedValue();
                mockTeamRepository.createCanonicalSchoolRecord.mockResolvedValue();
                mockTeamRepository.deleteCanonicalSchoolRecord.mockResolvedValue();
                setGameServiceRepositories(mockTeamRepository, mockGameRepository, mockUpdateEntrywithNewSchools);
            });

            describe("updateTeamRecords round 0", () => {
                test("sets winner on the FF game", async () => {
                    await updateTeamRecords(10, 20, 0, 64, 5, 1, 2024);
                    expect(mockGameRepository.updateWinner).toHaveBeenCalledWith(64, 10, 2024);
                });

                test("propagates winner to R1 game slot", async () => {
                    await updateTeamRecords(10, 20, 0, 64, 5, 1, 2024);
                    expect(mockGameRepository.updateNextGameTeam).toHaveBeenCalledWith(5, 1, 10, 2024);
                });

                test("auto-swaps entry picks: loser → winner", async () => {
                    await updateTeamRecords(10, 20, 0, 64, 5, 1, 2024);
                    expect(mockUpdateEntrywithNewSchools).toHaveBeenCalledWith([[10, 20]], 2024);
                });

                test("creates canonical school record for winner", async () => {
                    await updateTeamRecords(10, 20, 0, 64, 5, 1, 2024);
                    expect(mockTeamRepository.createCanonicalSchoolRecord).toHaveBeenCalledWith(10, 2024);
                });

                test("does NOT update team records (no points awarded)", async () => {
                    await updateTeamRecords(10, 20, 0, 64, 5, 1, 2024);
                    expect(mockTeamRepository.updateTeamRecord).not.toHaveBeenCalled();
                    expect(mockTeamRepository.updateTeamRecordWithNulls).not.toHaveBeenCalled();
                });

                test("skips updateNextGameTeam when nextGame is falsy", async () => {
                    await updateTeamRecords(10, 20, 0, 64, null, null, 2024);
                    expect(mockGameRepository.updateNextGameTeam).not.toHaveBeenCalled();
                    expect(mockGameRepository.updateWinner).toHaveBeenCalledWith(64, 10, 2024);
                });

                test("writes the winner LAST — after slot fill, pick swap, and canonical record", async () => {
                    // The winner field is the poll's retry gate: every other step
                    // must commit first so a mid-resolution failure is retried.
                    await updateTeamRecords(10, 20, 0, 64, 5, 1, 2024);
                    const winnerOrder = mockGameRepository.updateWinner.mock.invocationCallOrder[0];
                    expect(mockGameRepository.updateNextGameTeam.mock.invocationCallOrder[0]).toBeLessThan(winnerOrder);
                    expect(mockUpdateEntrywithNewSchools.mock.invocationCallOrder[0]).toBeLessThan(winnerOrder);
                    expect(mockTeamRepository.createCanonicalSchoolRecord.mock.invocationCallOrder[0]).toBeLessThan(winnerOrder);
                });

                test("does NOT mark the game resolved if the pick swap fails (poll can retry)", async () => {
                    mockUpdateEntrywithNewSchools.mockRejectedValue(new Error("swap failed"));
                    await expect(updateTeamRecords(10, 20, 0, 64, 5, 1, 2024)).rejects.toThrow("swap failed");
                    expect(mockGameRepository.updateWinner).not.toHaveBeenCalled();
                });

                test("does NOT mark the game resolved if the canonical record create fails", async () => {
                    mockTeamRepository.createCanonicalSchoolRecord.mockRejectedValue(new Error("canonical failed"));
                    await expect(updateTeamRecords(10, 20, 0, 64, 5, 1, 2024)).rejects.toThrow("canonical failed");
                    expect(mockGameRepository.updateWinner).not.toHaveBeenCalled();
                });

                test("a failed resolution converges when the next poll run retries it", async () => {
                    // Run 1: the pick swap fails mid-resolution → winner never written,
                    // so the game stays in the poll's unresolved set.
                    mockUpdateEntrywithNewSchools.mockRejectedValueOnce(new Error("transient"));
                    await expect(updateTeamRecords(10, 20, 0, 64, 5, 1, 2024)).rejects.toThrow("transient");
                    expect(mockGameRepository.updateNextGameTeam).toHaveBeenCalledTimes(1);
                    expect(mockTeamRepository.createCanonicalSchoolRecord).not.toHaveBeenCalled();
                    expect(mockGameRepository.updateWinner).not.toHaveBeenCalled();

                    // Run 2 (next poll cycle): every idempotent step re-runs and the
                    // winner is finally committed exactly once.
                    await updateTeamRecords(10, 20, 0, 64, 5, 1, 2024);
                    expect(mockGameRepository.updateNextGameTeam).toHaveBeenCalledTimes(2);
                    expect(mockUpdateEntrywithNewSchools).toHaveBeenCalledTimes(2);
                    expect(mockTeamRepository.createCanonicalSchoolRecord).toHaveBeenCalledTimes(1);
                    expect(mockGameRepository.updateWinner).toHaveBeenCalledTimes(1);
                    expect(mockGameRepository.updateWinner).toHaveBeenCalledWith(64, 10, 2024);
                });
            });

            describe("undoTeamRecords round 0", () => {
                test("clears winner on the FF game with a manual hold (poll must not re-resolve)", async () => {
                    await undoTeamRecords(10, 20, 0, 64, 5, 1, 2024);
                    expect(mockGameRepository.clearWinnerWithHold).toHaveBeenCalledWith(64, 2024);
                    expect(mockGameRepository.updateWinner).not.toHaveBeenCalled();
                });

                test("clears team from R1 game slot", async () => {
                    await undoTeamRecords(10, 20, 0, 64, 5, 1, 2024);
                    expect(mockGameRepository.updateNextGameTeam).toHaveBeenCalledWith(5, 1, null, 2024);
                });

                test("reverses pick swap: winner → loser (last-resort fallback when no team1ID and no game doc)", async () => {
                    // No team1ID provided AND the game doc can't be found
                    // (getFirstFourGames mocked empty) → fallback: [[loser, winner]]
                    await undoTeamRecords(10, 20, 0, 64, 5, 1, 2024);
                    expect(mockUpdateEntrywithNewSchools).toHaveBeenCalledWith([[20, 10]], 2024);
                });

                test("derives team1ID from the game doc when the caller omits it", async () => {
                    // team1 (100) won. The blind reverse-swap would move picks to
                    // the LOSER (200); derivation must normalize to team1 instead.
                    mockGameRepository.getFirstFourGames.mockResolvedValue([
                        { gameID: 64, round: 0, team1ID: 100, team2ID: 200, winner: 100 },
                    ]);
                    await undoTeamRecords(100, 200, 0, 64, 5, 1, 2024);
                    expect(mockUpdateEntrywithNewSchools).toHaveBeenCalledWith([[100, 200]], 2024);
                });

                test("deletes canonical school record for winner", async () => {
                    await undoTeamRecords(10, 20, 0, 64, 5, 1, 2024);
                    expect(mockTeamRepository.deleteCanonicalSchoolRecord).toHaveBeenCalledWith(10, 2024);
                });

                test("does NOT touch team records", async () => {
                    await undoTeamRecords(10, 20, 0, 64, 5, 1, 2024);
                    expect(mockTeamRepository.updateTeamRecord).not.toHaveBeenCalled();
                    expect(mockTeamRepository.updateTeamRecordWithNulls).not.toHaveBeenCalled();
                });

                test("skips updateNextGameTeam when nextGame is falsy", async () => {
                    await undoTeamRecords(10, 20, 0, 64, null, null, 2024);
                    expect(mockGameRepository.updateNextGameTeam).not.toHaveBeenCalled();
                    expect(mockGameRepository.clearWinnerWithHold).toHaveBeenCalledWith(64, 2024);
                });

                test("clears the winner LAST — after pick repick, canonical delete, and slot clear", async () => {
                    // Mirror of resolution: a mid-undo failure must leave the game
                    // resolved so the admin can retry and the poll keeps skipping it.
                    await undoTeamRecords(10, 20, 0, 64, 5, 1, 2024);
                    const clearOrder = mockGameRepository.clearWinnerWithHold.mock.invocationCallOrder[0];
                    expect(mockUpdateEntrywithNewSchools.mock.invocationCallOrder[0]).toBeLessThan(clearOrder);
                    expect(mockTeamRepository.deleteCanonicalSchoolRecord.mock.invocationCallOrder[0]).toBeLessThan(clearOrder);
                    expect(mockGameRepository.updateNextGameTeam.mock.invocationCallOrder[0]).toBeLessThan(clearOrder);
                });

                test("does NOT reopen the game if the pick repick fails", async () => {
                    mockUpdateEntrywithNewSchools.mockRejectedValue(new Error("repick failed"));
                    await expect(undoTeamRecords(10, 20, 0, 64, 5, 1, 2024)).rejects.toThrow("repick failed");
                    expect(mockGameRepository.clearWinnerWithHold).not.toHaveBeenCalled();
                });

                test("a failed undo converges when the admin retries it", async () => {
                    // Attempt 1: canonical-record delete fails after the repick →
                    // winner stays set, so the poll keeps skipping the game and the
                    // admin sees the failure and clicks Undo again.
                    mockTeamRepository.deleteCanonicalSchoolRecord.mockRejectedValueOnce(new Error("transient"));
                    await expect(undoTeamRecords(200, 100, 0, 64, 5, 1, 2024, 100)).rejects.toThrow("transient");
                    expect(mockUpdateEntrywithNewSchools).toHaveBeenCalledTimes(1);
                    expect(mockGameRepository.updateNextGameTeam).not.toHaveBeenCalled();
                    expect(mockGameRepository.clearWinnerWithHold).not.toHaveBeenCalled();

                    // Attempt 2: repick is a no-op (already normalized), delete and
                    // slot-clear complete, and the winner is cleared with the hold.
                    await undoTeamRecords(200, 100, 0, 64, 5, 1, 2024, 100);
                    expect(mockUpdateEntrywithNewSchools).toHaveBeenCalledTimes(2);
                    expect(mockTeamRepository.deleteCanonicalSchoolRecord).toHaveBeenCalledTimes(2);
                    expect(mockGameRepository.updateNextGameTeam).toHaveBeenCalledTimes(1);
                    expect(mockGameRepository.clearWinnerWithHold).toHaveBeenCalledTimes(1);
                    expect(mockGameRepository.clearWinnerWithHold).toHaveBeenCalledWith(64, 2024);
                });

                describe("swap logic with team1ID provided", () => {
                    // team1ID=100 is the canonical pick sID for unresolved FF games.
                    // The undo must restore picks to team1ID regardless of which team won.

                    test("when team1 won: normalizes any stale team2 picks back to team1", async () => {
                        // winner=100 (team1), loser=200 (team2), team1ID=100
                        // branch: team2ID=loser=200, condition1 false, condition2 true → [[100, 200]]
                        await undoTeamRecords(100, 200, 0, 64, 5, 1, 2024, 100);
                        expect(mockUpdateEntrywithNewSchools).toHaveBeenCalledWith([[100, 200]], 2024);
                    });

                    test("when team2 won: swaps winner picks back to team1", async () => {
                        // winner=200 (team2), loser=100 (team1), team1ID=100
                        // branch: team2ID=winner=200, condition1 true → [[100, 200]], condition2 false
                        await undoTeamRecords(200, 100, 0, 64, 5, 1, 2024, 100);
                        expect(mockUpdateEntrywithNewSchools).toHaveBeenCalledWith([[100, 200]], 2024);
                    });

                    test("always deletes canonical record for the winner regardless of which team won", async () => {
                        await undoTeamRecords(200, 100, 0, 64, 5, 1, 2024, 100);
                        expect(mockTeamRepository.deleteCanonicalSchoolRecord).toHaveBeenCalledWith(200, 2024);
                    });
                });
            });
        });
    });

    describe("ViewService", () => {
        beforeEach(() => {
            setViewServiceRepositories(mockViewRepository, mockGameRepository, mockEntryRepository);
        });

        describe("normalizeFirstFourPicks", () => {
            // FF game 64: team1=100, team2=200. Non-FF pick 50 must pass through.
            test("unresolved FF game: either FF team normalizes to team1ID (combined convention)", async () => {
                mockGameRepository.getFirstFourGames.mockResolvedValue([
                    { gameID: 64, round: 0, team1ID: 100, team2ID: 200, winner: null },
                ]);
                expect(await normalizeFirstFourPicks([100, 50], 2024)).toEqual([100, 50]);
                expect(await normalizeFirstFourPicks([200, 50], 2024)).toEqual([100, 50]);
            });

            test("resolved FF game: any FF-team pick normalizes to the winner — regardless of who was picked", async () => {
                mockGameRepository.getFirstFourGames.mockResolvedValue([
                    { gameID: 64, round: 0, team1ID: 100, team2ID: 200, winner: 200 },
                ]);
                // combined pick, loser pick, and winner pick all land on the winner
                expect(await normalizeFirstFourPicks([100, 50], 2024)).toEqual([200, 50]);
                expect(await normalizeFirstFourPicks([200, 50], 2024)).toEqual([200, 50]);
            });

            test("heals a pre-existing stranded loser pick on the next edit", async () => {
                mockGameRepository.getFirstFourGames.mockResolvedValue([
                    { gameID: 64, round: 0, team1ID: 100, team2ID: 200, winner: 100 },
                ]);
                expect(await normalizeFirstFourPicks([200], 2024)).toEqual([100]);
            });

            test("submitting both FF teams of one game collapses to a duplicate (caught by validation upstream)", async () => {
                mockGameRepository.getFirstFourGames.mockResolvedValue([
                    { gameID: 64, round: 0, team1ID: 100, team2ID: 200, winner: null },
                ]);
                expect(await normalizeFirstFourPicks([100, 200], 2024)).toEqual([100, 100]);
            });

            test("multiple FF games normalize independently", async () => {
                mockGameRepository.getFirstFourGames.mockResolvedValue([
                    { gameID: 64, round: 0, team1ID: 100, team2ID: 200, winner: null },
                    { gameID: 65, round: 0, team1ID: 300, team2ID: 400, winner: 400 },
                ]);
                expect(await normalizeFirstFourPicks([200, 300, 50], 2024)).toEqual([100, 400, 50]);
            });

            test("no FF games: picks pass through untouched (new array)", async () => {
                mockGameRepository.getFirstFourGames.mockResolvedValue([]);
                const picks = [1, 2, 3];
                const result = await normalizeFirstFourPicks(picks, 2024);
                expect(result).toEqual([1, 2, 3]);
                expect(result).not.toBe(picks);
            });

            test("string-typed pick ids still match FF teams (Number coercion)", async () => {
                mockGameRepository.getFirstFourGames.mockResolvedValue([
                    { gameID: 64, round: 0, team1ID: 100, team2ID: 200, winner: 200 },
                ]);
                expect(await normalizeFirstFourPicks(["100"], 2024)).toEqual([200]);
            });
        });

        describe("createNewEntry", () => {
            test("should create new entry with correct parameters", async () => {
                const email = "test@example.com";
                const teamName = "Test Team";
                const personName = "John Doe";
                const groupName = "Test Group";
                const picks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

                mockEntryRepository.createEntry.mockResolvedValue();
                mockGameRepository.getEntryById.mockResolvedValue(null); // id is free

                vi.spyOn(Date.prototype, "toISOString").mockReturnValue("2024-01-01T00:00:00.000Z");

                await createNewEntry(
                    email,
                    teamName,
                    personName,
                    groupName,
                    picks
                );

                expect(mockEntryRepository.createEntry).toHaveBeenCalledWith(
                    expect.any(Number), // cryptographically-random id
                    email,
                    teamName,
                    picks,
                    groupName,
                    personName,
                    "2024-01-01T00:00:00.000Z",
                    expect.any(Number), // year
                    0 // default maxPoints
                );
            });

            test("should create entry with explicit year and maxPoints", async () => {
                const email = "test@example.com";
                const teamName = "Test Team";
                const personName = "John Doe";
                const groupName = "Test Group";
                const picks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
                const year = 2025;
                const maxPoints = 150;

                mockEntryRepository.createEntry.mockResolvedValue();
                mockGameRepository.getEntryById.mockResolvedValue(null); // id is free

                vi.spyOn(Date.prototype, "toISOString").mockReturnValue("2024-01-01T00:00:00.000Z");

                await createNewEntry(
                    email,
                    teamName,
                    personName,
                    groupName,
                    picks,
                    year,
                    maxPoints
                );

                expect(mockEntryRepository.createEntry).toHaveBeenCalledWith(
                    expect.any(Number), // cryptographically-random id
                    email,
                    teamName,
                    picks,
                    groupName,
                    personName,
                    "2024-01-01T00:00:00.000Z",
                    year,
                    maxPoints
                );
            });
        });

        describe("verifyGroupExists", () => {
            test("should return group name when group exists", async () => {
                const groupName = "Test Group";
                const expectedResult = "Test Group: 1";

                mockViewRepository.findGroupByName.mockResolvedValue(expectedResult);

                const result = await verifyGroupExists(groupName);

                expect(mockViewRepository.findGroupByName).toHaveBeenCalledWith(groupName);
                expect(result).toBe(expectedResult);
            });

            test("should return null when group does not exist", async () => {
                const groupName = "Non-existent Group";

                mockViewRepository.findGroupByName.mockResolvedValue(null);

                const result = await verifyGroupExists(groupName);

                expect(mockViewRepository.findGroupByName).toHaveBeenCalledWith(groupName);
                expect(result).toBeNull();
            });
        });

        describe("getGroupTeamDetails", () => {
            test("should get teams for group", async () => {
                const groupName = "Test Group";
                const year = 2024;
                const mockTeams = [
                    { id: 1, teamName: "Team A", totalPoints: 50, picks: [1, 2] },
                    { id: 2, teamName: "Team B", totalPoints: 75, picks: [3, 4] },
                ];

                mockViewRepository.getGroupTeams.mockResolvedValue(mockTeams);
                mockGameRepository.getAllTournamentDetails.mockResolvedValue({ teams: [], allGames: [], activeGames: [], regions: [] });

                const [mappedGroupTeams, resultsSoFar] = await getGroupTeamDetails(groupName, year);

                expect(mockViewRepository.getGroupTeams).toHaveBeenCalledWith(groupName, year);
                expect(mockGameRepository.getAllTournamentDetails).toHaveBeenCalledWith(year);
                expect(mappedGroupTeams).toEqual(mockTeams.map(team => ({ ...team, pickNames: [] })));
            });
        });

        describe("getAllYearsforGroup", () => {
            test("should get all years for group", async () => {
                const groupName = "Test Group";
                const mockYears = [{ year: 2024 }, { year: 2023 }];

                mockGameRepository.getAllYearsForGroup.mockResolvedValue(mockYears);

                const result = await getAllYearsforGroup(groupName);

                expect(mockGameRepository.getAllYearsForGroup).toHaveBeenCalledWith(groupName);
                expect(result).toEqual([2024, 2023]);
            });
        });

        describe("getRegionsForYear", () => {
            test("should get regions for year", async () => {
                const year = 2024;
                const mockDetails = {
                    teams: [],
                    allGames: [],
                    activeGames: [],
                    regions: [
                        { regionID: 1, regionName: "East" },
                        { regionID: 2, regionName: "West" },
                        { regionID: 3, regionName: "South" },
                        { regionID: 4, regionName: "Midwest" },
                    ],
                };

                mockGameRepository.getAllTournamentDetails.mockResolvedValue(mockDetails);

                const result = await getRegionsForYear(year);

                expect(mockGameRepository.getAllTournamentDetails).toHaveBeenCalledWith(year);
                expect(result).toEqual(["East", "West", "South", "Midwest"]);
            });
        });

        describe("findEntriesByName", () => {
            test("should find entries by name", async () => {
                const name = "John";
                const year = 2024;
                const mockEntries = [
                    { id: 1, teamName: "Test Team", person: "John Doe" },
                ];

                mockEntryRepository.findEntriesByName.mockResolvedValue(mockEntries);

                const result = await findEntriesByName(name, year);

                expect(mockEntryRepository.findEntriesByName).toHaveBeenCalledWith(name, year);
                expect(result).toEqual(mockEntries);
            });
        });
    });

    describe("TourneyService", () => {
        beforeEach(() => {
            tourneyService.setRepositories(mockTourneyRepository, mockGameRepository, mockEntryRepository, mockConferenceRepository);
        });
        describe("createNewBracketStructure", () => {
            test("should create bracket structure correctly", async () => {
                const year = 2024;
                const regionArray = [1, 2, 3, 4];
                const games = [
                    "1-1-1-1",
                    "1-1-16-16",
                    "1-2-8-8",
                    "1-2-9-9",
                    "2-16-1-2",
                    "2-16-16-17",
                    "2-17-8-9",
                    "2-17-9-10",
                ];

                const result = await tourneyService.createNewBracketStructure(
                    games,
                    year,
                    regionArray
                );

                expect(result).toHaveProperty("gamesFormat");
                expect(result).toHaveProperty("teamRecordFormat");
                expect(Array.isArray(result.gamesFormat)).toBe(true);
                expect(Array.isArray(result.teamRecordFormat)).toBe(true);
            });

            test("should handle empty games array", async () => {
                const year = 2024;
                const regionArray = [1, 2, 3, 4];
                const games = [];

                const result = await tourneyService.createNewBracketStructure(
                    games,
                    year,
                    regionArray
                );

                expect(result.gamesFormat).toEqual([]);
                expect(result.teamRecordFormat).toEqual([]);
            });

            // S1 regression: bounds assertions for the bracket structure tables.
            test("throws ValidationError when gamesData has an odd length (R1 games come in pairs)", () => {
                expect(() =>
                    tourneyService.createNewBracketStructure(["1-1-1-1"], 2024, [1, 2, 3, 4])
                ).toThrow(/even.*one pair per R1 game/);
            });

            test("throws ValidationError when gamesData exceeds the bracket's 32 R1-game capacity", () => {
                // 33 pairs = 66 entries, one over the bracket cap
                const oversized = Array.from({ length: 66 }, (_, i) => `1-${i + 1}-1-${i + 100}`);
                expect(() =>
                    tourneyService.createNewBracketStructure(oversized, 2024, [1, 2, 3, 4])
                ).toThrow(/only supports 32/);
            });
        });

        describe("createNewBracket", () => {
            beforeEach(() => {
                mockTourneyRepository.insertRegionsForYear.mockResolvedValue();
                mockTourneyRepository.insertMultipleGamesWithoutTeams.mockResolvedValue();
                mockTourneyRepository.insertMultipleGamesWithTeams.mockResolvedValue();
                mockTourneyRepository.insertMultipleSchoolRecords.mockResolvedValue();
                mockTourneyRepository.upsertTournamentDoc.mockResolvedValue();
                mockTourneyRepository.insertFirstFourGames.mockResolvedValue();
                mockTourneyRepository.insertFirstFourSchoolRecords.mockResolvedValue();
            });

            test("should create new bracket successfully", async () => {
                const year = 2024;
                const regionArray = [1, 2, 3, 4];
                const games = [
                    "1-1-1-1",
                    "1-1-16-16",
                    "1-2-8-8",
                    "1-2-9-9",
                ];

                await tourneyService.createNewBracket(games, year, regionArray);

                expect(mockTourneyRepository.insertRegionsForYear).toHaveBeenCalled();
                expect(mockTourneyRepository.insertMultipleGamesWithoutTeams).toHaveBeenCalled();
                expect(mockTourneyRepository.insertMultipleGamesWithTeams).toHaveBeenCalled();
                expect(mockTourneyRepository.insertMultipleSchoolRecords).toHaveBeenCalled();
            });

            test("without FF: calls upsertTournamentDoc with no options", async () => {
                await tourneyService.createNewBracket(["1-1-1-1", "1-1-16-16"], 2024, [1, 2, 3, 4]);
                expect(mockTourneyRepository.upsertTournamentDoc).toHaveBeenCalledWith(2024);
                expect(mockTourneyRepository.insertFirstFourGames).not.toHaveBeenCalled();
            });

            test("with FF: calls insertFirstFourGames and upsertTournamentDoc with hasFirstFour", async () => {
                const firstFourData = [
                    { team1ID: 100, team2ID: 200, seed: 16, nextGameID: 1, nextGameSpot: 1 },
                ];

                await tourneyService.createNewBracket(["1-1-1-1", "1-1-16-16"], 2024, [1, 2, 3, 4], firstFourData);

                expect(mockTourneyRepository.insertFirstFourGames).toHaveBeenCalled();
                expect(mockTourneyRepository.insertFirstFourSchoolRecords).toHaveBeenCalled();
                expect(mockTourneyRepository.upsertTournamentDoc).toHaveBeenCalledWith(2024, {
                    hasFirstFour: true,
                    firstFourGameCount: 1,
                });
            });

            describe("FF-fed R1 slot: creation and winner propagation", () => {
                // Scenario: game 1 has seed-1 team (sID 10) in slot 1 and a blank slot 2 that
                // will be filled by the winner of FF game 64. The FF game has teams 100 and 200.
                // After the FF game resolves with team 100 winning, updateNextGameTeam should
                // fill slot 2 of game 1 with sID 100.
                const year = 2024;
                const regionArray = [1, 2, 3, 4];
                // Blank teamSID (empty string after the final dash) → null in createNewBracketStructure
                const gamesData = ["1-1-1-10", "1-1-16-"];
                const firstFourData = [
                    { team1ID: 100, team2ID: 200, seed: 16, nextGameID: 1, nextGameSpot: 2 },
                ];

                test("R1 game with one FF-fed slot is passed to insertMultipleGamesWithTeams (not dropped)", async () => {
                    await tourneyService.createNewBracket(gamesData, year, regionArray, firstFourData);

                    const gamesWithTeams = mockTourneyRepository.insertMultipleGamesWithTeams.mock.calls[0][0];
                    const r1Game = gamesWithTeams.find(g => g[0] === 1); // gameID 1
                    expect(r1Game).toBeDefined();
                });

                test("FF-fed R1 slot has one real team and one null team", async () => {
                    await tourneyService.createNewBracket(gamesData, year, regionArray, firstFourData);

                    const gamesWithTeams = mockTourneyRepository.insertMultipleGamesWithTeams.mock.calls[0][0];
                    const r1Game = gamesWithTeams.find(g => g[0] === 1);
                    const [, , , team1ID, team2ID] = r1Game;
                    expect(team1ID).toBe(10);    // slot 1: real team
                    expect(team2ID).toBeNull();   // slot 2: FF-fed, not yet known
                });

                test("R1 game with FF-fed slot is NOT in insertMultipleGamesWithoutTeams", async () => {
                    await tourneyService.createNewBracket(gamesData, year, regionArray, firstFourData);

                    const gamesWithoutTeams = mockTourneyRepository.insertMultipleGamesWithoutTeams.mock.calls[0][0];
                    const r1Game = gamesWithoutTeams.find(g => g[0] === 1);
                    expect(r1Game).toBeUndefined();
                });

                test("FF winner propagates into the blank R1 slot via updateTeamRecords round 0", async () => {
                    // Wire up game service with a mock updateEntrywithNewSchools
                    const mockUpdateEntries = vi.fn().mockResolvedValue();
                    mockGameRepository.updateWinner.mockResolvedValue();
                    mockGameRepository.updateNextGameTeam.mockResolvedValue();
                    setGameServiceRepositories(mockTeamRepository, mockGameRepository, mockUpdateEntries);

                    // FF game 64 resolves: team 100 wins, team 200 loses
                    // nextGame=1 (game 1), nextGameSpot=2 (slot 2 — the blank FF-fed slot)
                    await updateTeamRecords(100, 200, 0, 64, 1, 2, year);

                    expect(mockGameRepository.updateWinner).toHaveBeenCalledWith(64, 100, year);
                    expect(mockGameRepository.updateNextGameTeam).toHaveBeenCalledWith(1, 2, 100, year);
                    expect(mockUpdateEntries).toHaveBeenCalledWith([[100, 200]], year);
                });
            });
        });

        describe("createFirstFourGames", () => {
            beforeEach(() => {
                mockTourneyRepository.insertFirstFourGames.mockResolvedValue();
                mockTourneyRepository.insertFirstFourSchoolRecords.mockResolvedValue();
                tourneyService.setRepositories(
                    mockTourneyRepository,
                    mockGameRepository,
                    mockEntryRepository,
                    mockConferenceRepository
                );
            });

            test("assigns gameIDs starting at 64", async () => {
                const firstFourData = [
                    { team1ID: 100, team2ID: 200, seed: 16, nextGameID: 1, nextGameSpot: 1 },
                    { team1ID: 300, team2ID: 400, seed: 11, nextGameID: 2, nextGameSpot: 2 },
                ];

                await tourneyService.createFirstFourGames(firstFourData, 2024, [1, 2, 3, 4]);

                const gamesArg = mockTourneyRepository.insertFirstFourGames.mock.calls[0][0];
                expect(gamesArg[0].gameID).toBe(64);
                expect(gamesArg[1].gameID).toBe(65);
            });

            test("sets regionID 7 and round 0 via the games passed to insertFirstFourGames", async () => {
                // The repo method sets regionID/round — verify the seed and nextGame wiring
                const firstFourData = [
                    { team1ID: 100, team2ID: 200, seed: 11, nextGameID: 3, nextGameSpot: 2 },
                ];

                await tourneyService.createFirstFourGames(firstFourData, 2024, [1, 2, 3, 4]);

                const gamesArg = mockTourneyRepository.insertFirstFourGames.mock.calls[0][0];
                expect(gamesArg[0].seed).toBe(11);
                expect(gamesArg[0].nextGameID).toBe(3);
                expect(gamesArg[0].nextGameSpot).toBe(2);
            });

            test("creates two school records per FF game with correct slots", async () => {
                const firstFourData = [
                    { team1ID: 100, team2ID: 200, seed: 16, nextGameID: 1, nextGameSpot: 1 },
                ];

                await tourneyService.createFirstFourGames(firstFourData, 2024, [1, 2, 3, 4]);

                const recordsArg = mockTourneyRepository.insertFirstFourSchoolRecords.mock.calls[0][0];
                expect(recordsArg).toHaveLength(2);
                expect(recordsArg[0]).toMatchObject({ sID: 100, slot: 1, gameID: 64 });
                expect(recordsArg[1]).toMatchObject({ sID: 200, slot: 2, gameID: 64 });
            });

            test("resolves r1RegionID from nextGameID using regionArray", async () => {
                // nextGameID=1 → games 1-8 → regionArray[0]=1 (East)
                // nextGameID=16 → games 16-23 → regionArray[1]=2 (West)
                const firstFourData = [
                    { team1ID: 100, team2ID: 200, seed: 16, nextGameID: 1, nextGameSpot: 1 },
                    { team1ID: 300, team2ID: 400, seed: 11, nextGameID: 16, nextGameSpot: 2 },
                ];

                await tourneyService.createFirstFourGames(firstFourData, 2024, [1, 2, 3, 4]);

                const recordsArg = mockTourneyRepository.insertFirstFourSchoolRecords.mock.calls[0][0];
                expect(recordsArg[0].r1RegionID).toBe(1); // East
                expect(recordsArg[1].r1RegionID).toBe(1); // team2 of game 0 also gets East
                expect(recordsArg[2].r1RegionID).toBe(2); // West
                expect(recordsArg[3].r1RegionID).toBe(2);
            });
        });

        describe("updateBracket", () => {
            const year = 2024;
            const regionArray = [1, 2, 3, 4];

            beforeEach(() => {
                mockTourneyRepository.updateMultipleGamesWithTeams = vi.fn().mockResolvedValue();
                mockTourneyRepository.updateMultipleSchoolRecords = vi.fn().mockResolvedValue();
            });

            test("returns balanced [add, remove] pairs when add and remove counts match", async () => {
                // games "1-1-1-1" and "1-1-16-16" produce two teamRecords with sIDs 1 and 16
                mockTourneyRepository.getSchoolRecordsForYear.mockResolvedValue([
                    { sID: 101 },
                    { sID: 116 },
                ]);

                const result = await tourneyService.updateBracket(
                    ["1-1-1-1", "1-1-16-16"],
                    year,
                    regionArray
                );

                expect(result).toHaveLength(2);
                // Adds (newSIDs not in existing) and removes (existingSIDs not in new), zipped
                expect(result.map(([add]) => add).sort()).toEqual([1, 16]);
                expect(result.map(([, remove]) => remove).sort()).toEqual([101, 116]);
            });

            test("throws ValidationError when more schools are removed than added (C1 regression)", async () => {
                // Empty games → newSIDs = []. Two existing → sIDsToRemove = [201, 202], sIDsToAdd = []
                mockTourneyRepository.getSchoolRecordsForYear.mockResolvedValue([
                    { sID: 201 },
                    { sID: 202 },
                ]);

                await expect(
                    tourneyService.updateBracket([], year, regionArray)
                ).rejects.toThrow(/count mismatch.*0 additions vs 2 removals/);

                // Critically, the school-records / games writes must NOT have happened —
                // we'd rather fail loud than half-apply a structural change.
                expect(mockTourneyRepository.updateMultipleSchoolRecords).not.toHaveBeenCalled();
            });

            test("throws ValidationError when more schools are added than removed (C1 regression)", async () => {
                // Two new sIDs (1, 16), one existing that is also kept → sIDsToAdd = [1, 16], sIDsToRemove = []
                mockTourneyRepository.getSchoolRecordsForYear.mockResolvedValue([]);

                await expect(
                    tourneyService.updateBracket(["1-1-1-1", "1-1-16-16"], year, regionArray)
                ).rejects.toThrow(/count mismatch.*2 additions vs 0 removals/);
            });

            test("returns empty changes and writes nothing-new when add and remove sets are both empty", async () => {
                mockTourneyRepository.getSchoolRecordsForYear.mockResolvedValue([
                    { sID: 1 },
                    { sID: 16 },
                ]);

                const result = await tourneyService.updateBracket(
                    ["1-1-1-1", "1-1-16-16"],
                    year,
                    regionArray
                );

                expect(result).toEqual([]);
            });
        });

        describe("updateEntrywithNewSchools", () => {
            const year = 2024;

            beforeEach(() => {
                mockEntryRepository.updateEntryPicksWithSwaps = vi.fn().mockResolvedValue(true);
                mockGameRepository.getEntriesContainingTeams = vi.fn().mockResolvedValue([]);
            });

            test("applies all school changes to a single entry that matches multiple removals", async () => {
                mockGameRepository.getEntriesContainingTeams.mockResolvedValue([
                    { id: 1, picks: [1, 2, 3] },
                ]);

                await tourneyService.updateEntrywithNewSchools([[101, 1], [202, 2]], year);

                expect(mockGameRepository.getEntriesContainingTeams).toHaveBeenCalledWith(
                    year,
                    [1, 2]
                );
                expect(mockEntryRepository.updateEntryPicksWithSwaps).toHaveBeenCalledWith(
                    1,
                    [[101, 1], [202, 2]],
                    year
                );
            });

            test("produces one update object per entry, not one per school change", async () => {
                mockGameRepository.getEntriesContainingTeams.mockResolvedValue([
                    { id: 1, picks: [1, 2] },
                ]);

                await tourneyService.updateEntrywithNewSchools([[101, 1], [202, 2]], year);

                expect(mockEntryRepository.updateEntryPicksWithSwaps).toHaveBeenCalledTimes(1);
            });

            test("skips entries whose picks are unaffected by any school change", async () => {
                // Since getEntriesContainingTeams only returns entries that have the teams,
                // entry 1 (picks: [5, 6]) wouldn't be returned by the DB query.
                mockGameRepository.getEntriesContainingTeams.mockResolvedValue([
                    { id: 2, picks: [1, 2] },
                ]);

                await tourneyService.updateEntrywithNewSchools([[101, 1], [202, 2]], year);

                expect(mockEntryRepository.updateEntryPicksWithSwaps).toHaveBeenCalledTimes(1);
                expect(mockEntryRepository.updateEntryPicksWithSwaps).toHaveBeenCalledWith(
                    2,
                    [[101, 1], [202, 2]],
                    year
                );
            });

            test("skips changes where removeSID is falsy", async () => {
                mockGameRepository.getEntriesContainingTeams.mockResolvedValue([
                    { id: 1, picks: [1] },
                ]);

                await tourneyService.updateEntrywithNewSchools([[101, null], [202, 1]], year);

                expect(mockGameRepository.getEntriesContainingTeams).toHaveBeenCalledWith(
                    year,
                    [1]
                );
                expect(mockEntryRepository.updateEntryPicksWithSwaps).toHaveBeenCalledWith(
                    1,
                    [[101, null], [202, 1]],
                    year
                );
            });
        });

        describe("prepareRegionVerifyData", () => {
            test("should prepare region verify data correctly", async () => {
                const regions = [1, 2, 3, 4];
                const mockRegions = [
                    { regionID: 1, regionName: "East" },
                    { regionID: 2, regionName: "West" },
                    { regionID: 3, regionName: "South" },
                    { regionID: 4, regionName: "Midwest" },
                ];
                const mockTeams = [
                    { sid: 1, name: "Team A" },
                    { sid: 2, name: "Team B" },
                ];

                mockTourneyRepository.getAllRegionTypes.mockResolvedValue(mockRegions);
                mockTourneyRepository.getAllTeams.mockResolvedValue(mockTeams);
                mockConferenceRepository.getAllConferences.mockResolvedValue([]);

                const year = 2026;
                const result = await tourneyService.prepareRegionVerifyData(regions, year);

                expect(result).toHaveProperty("regions", regions);
                expect(result).toHaveProperty("regionNames");
                expect(result).toHaveProperty("allTeams", mockTeams);
                expect(result).toHaveProperty("seeds");
                expect(mockTourneyRepository.getAllRegionTypes).toHaveBeenCalled();
                expect(mockTourneyRepository.getAllTeams).toHaveBeenCalled();
            });
        });
    });
});
