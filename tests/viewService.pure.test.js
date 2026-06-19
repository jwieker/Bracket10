/**
 * Regression tests for viewService transformation functions.
 *
 * Purpose: Verify that the exact outputs of addPickCount, addTeamProgressforGroup,
 * getGroupTeamDetails, buildFullGridData, and buildGameViewData do not change
 * when their internal implementations are optimized (e.g. .find() → Map).
 *
 * These tests use mocked repositories via setRepositories() and a mocked
 * enrichEntriesWithPotentialRankings so no Firestore connection is needed.
 */


import {
  addPickCount,
  addTeamProgressforGroup,
  getGroupTeamDetails,
  buildFullGridData,
  buildGameViewData,
  getEntriesForUser,
  getEntryIdsForUserInGroup,
  setRepositories,
} from '../src/services/viewService.js';
import { thisYear } from '../src/config/app.js';

// Mock pointsService so buildFullGridData does not need real game data to compute
// potential rankings. enrichEntriesWithPotentialRankings is configured per-test.
vi.mock('../src/services/pointsService.js', () => ({
  enrichEntriesWithPotentialRankings: vi.fn(async (entries) => entries),
  calculateEntryPointsAndPaths: vi.fn(),
  findNextGameId: vi.fn(),
  getNextFutureGame: vi.fn(),
  getFuturePoints: vi.fn(),
}));

// Mock repository classes so no real Firestore is needed.
vi.mock('../src/repositories/hierarchicalRepository.js');

vi.mock('../src/utils/cacheUtils.js', () => ({
  cacheGet: vi.fn(() => null),
  cacheSet: vi.fn(),
}));

import { enrichEntriesWithPotentialRankings, calculateEntryPointsAndPaths } from '../src/services/pointsService.js';
import { calculateMaxPossiblePoints } from '../src/services/viewService.js';

// ─── Shared test fixtures ────────────────────────────────────────────────────

const TEAMS = [
  { sID: 1, name: 'Duke',    seed: 1, gameStatus: null },
  { sID: 2, name: 'Kansas',  seed: 2, gameStatus: null },
  { sID: 3, name: 'UNC',     seed: 3, gameStatus: null },
  { sID: 4, name: 'Gonzaga', seed: 4, gameStatus: null },
];

// ─────────────────────────────────────────────────────────────────────────────
// getEntriesForUser — "My Brackets" dashboard shaping
// ─────────────────────────────────────────────────────────────────────────────

describe('getEntriesForUser', () => {
  let mockGameRepo;

  beforeEach(() => {
    mockGameRepo = { getEntriesByEmail: vi.fn() };
    setRepositories({}, mockGameRepo, {}, {});
  });

  it('normalizes legacy singular `group`, derives viewGroup, and marks only the current year editable', async () => {
    // isRegistrationOpen() is true in the test env, so editability turns on the year.
    mockGameRepo.getEntriesByEmail.mockResolvedValue([
      { id: 'a', year: thisYear, email: 'u@g.com', person: 'P1', teamName: 'T1', groups: ['G1'], totalPoints: 5, possPoints: 50 },
      { id: 'b', year: thisYear - 1, email: 'u@g.com', person: 'P2', teamName: 'T2', group: 'G2', totalPoints: 3 },
    ]);

    const result = await getEntriesForUser('u@g.com');

    expect(mockGameRepo.getEntriesByEmail).toHaveBeenCalledWith('u@g.com');
    expect(result).toHaveLength(2);

    // Current-year entry: editable, groups passed through, viewGroup from groups[0].
    expect(result[0]).toMatchObject({
      id: 'a', year: thisYear, groups: ['G1'], viewGroup: 'G1', editable: true, totalPoints: 5, possPoints: 50,
    });

    // Past-year entry: NOT editable; legacy singular `group` normalized into an array.
    expect(result[1]).toMatchObject({
      id: 'b', year: thisYear - 1, groups: ['G2'], viewGroup: 'G2', editable: false,
    });
    // possPoints defaults to 0 when absent.
    expect(result[1].possPoints).toBe(0);
  });

  it('returns an empty list when the user has no entries', async () => {
    mockGameRepo.getEntriesByEmail.mockResolvedValue([]);
    expect(await getEntriesForUser('nobody@g.com')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getEntryIdsForUserInGroup — highlight "your" rows on the results page
// ─────────────────────────────────────────────────────────────────────────────

describe('getEntryIdsForUserInGroup', () => {
  let mockGameRepo;

  beforeEach(() => {
    mockGameRepo = { getEntriesByEmail: vi.fn() };
    setRepositories({}, mockGameRepo, {}, {});
  });

  it('returns only the IDs matching the requested group AND year (as strings)', async () => {
    mockGameRepo.getEntriesByEmail.mockResolvedValue([
      { id: 1, year: 2026, groups: ['Fam', 'Work'] },   // match
      { id: 2, year: 2026, groups: ['Other'] },          // wrong group
      { id: 3, year: 2025, groups: ['Fam'] },            // wrong year
      { id: 4, year: 2026, group: 'Fam' },               // legacy singular group → match
    ]);

    const ids = await getEntryIdsForUserInGroup('u@g.com', 'Fam', 2026);

    // Scoped to the requested year so it doesn't scan every tournament year.
    expect(mockGameRepo.getEntriesByEmail).toHaveBeenCalledWith('u@g.com', 2026);
    expect(ids).toEqual(['1', '4']);
  });

  it('returns [] when no email is provided (skips the lookup entirely)', async () => {
    const ids = await getEntryIdsForUserInGroup('', 'Fam', 2026);
    expect(ids).toEqual([]);
    expect(mockGameRepo.getEntriesByEmail).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// addPickCount
// ─────────────────────────────────────────────────────────────────────────────

describe('addPickCount', () => {
  it('counts how many entries picked each team', async () => {
    const teams = [{ sID: 1 }, { sID: 2 }, { sID: 3 }];
    const entries = [
      { picks: [1, 2] },
      { picks: [1, 3] },
      { picks: [2, 3] },
    ];
    await addPickCount(teams, entries);
    expect(teams[0].pickCount).toBe(2); // sID 1: entries 0 & 1
    expect(teams[1].pickCount).toBe(2); // sID 2: entries 0 & 2
    expect(teams[2].pickCount).toBe(2); // sID 3: entries 1 & 2
  });

  it('gives pickCount 0 for a team not picked by anyone', async () => {
    const teams = [{ sID: 1 }, { sID: 99 }];
    await addPickCount(teams, [{ picks: [1] }]);
    expect(teams[0].pickCount).toBe(1);
    expect(teams[1].pickCount).toBe(0);
  });

  it('handles an empty entries array without error', async () => {
    const teams = [{ sID: 1 }, { sID: 2 }];
    await addPickCount(teams, []);
    expect(teams[0].pickCount).toBe(0);
    expect(teams[1].pickCount).toBe(0);
  });

  it('returns the same teams array reference (mutates in-place)', async () => {
    const teams = [{ sID: 1 }];
    const result = await addPickCount(teams, []);
    expect(result).toBe(teams);
  });

  it('handles a single entry picking all teams', async () => {
    const teams = [{ sID: 1 }, { sID: 2 }, { sID: 3 }];
    await addPickCount(teams, [{ picks: [1, 2, 3] }]);
    expect(teams.every(t => t.pickCount === 1)).toBe(true);
  });

  it('handles multiple entries all picking the same team', async () => {
    const teams = [{ sID: 1 }, { sID: 2 }];
    const entries = [{ picks: [1] }, { picks: [1] }, { picks: [1] }];
    await addPickCount(teams, entries);
    expect(teams[0].pickCount).toBe(3);
    expect(teams[1].pickCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// addTeamProgressforGroup
// ─────────────────────────────────────────────────────────────────────────────

describe('addTeamProgressforGroup', () => {
  // Helper: build an entry whose picks have the given gameStatus values
  const makeEntry = (gameStatuses) => ({
    pickNames: gameStatuses.map((gs, i) => ({ sID: i + 1, gameStatus: gs })),
  });

  it('marks un-played picks as toPlay, each using its pick index as the round slot', async () => {
    const allTeams = [{ gameStatus: null }, { gameStatus: null }];
    const entry = makeEntry([null, null]);
    const [result] = await addTeamProgressforGroup([entry], allTeams);

    // picksProgress[round][0=wins, 1=losses, 2=toPlay, 3=points]
    // For null gameStatus, the code uses picksProgress[j][2]++ where j is the pick index —
    // so pick 0 increments row 0, pick 1 increments row 1 (not both into row 0).
    expect(result.picksProgress[0][2]).toBe(1); // pick 0 is toPlay
    expect(result.picksProgress[1][2]).toBe(1); // pick 1 is toPlay
    expect(result.picksProgress[0][0]).toBe(0);
    expect(result.teamsRemaining).toBe(10);     // starts at 10, no losses
    expect(result.teamsAdvanced).toBe(0);       // between rounds → no advanced count
  });

  it('records a round-1 win with correct points and advances pick to round 2', async () => {
    const allTeams = [{ gameStatus: ['W'] }];
    const entry = makeEntry([['W']]);
    const [result] = await addTeamProgressforGroup([entry], allTeams);

    expect(result.picksProgress[0][0]).toBe(1); // 1 win in R1
    expect(result.picksProgress[0][3]).toBe(2); // 2 pts (R1 roundPoints)
    expect(result.picksProgress[1][2]).toBe(1); // pick is now toPlay in R2
    expect(result.teamsRemaining).toBe(10);
  });

  it('records a win then loss and decrements teamsRemaining by 1', async () => {
    const allTeams = [{ gameStatus: ['W', 'L'] }];
    const entry = makeEntry([['W', 'L']]);
    const [result] = await addTeamProgressforGroup([entry], allTeams);

    expect(result.picksProgress[0][0]).toBe(1); // win R1
    expect(result.picksProgress[0][3]).toBe(2); // 2 pts from R1
    expect(result.picksProgress[1][1]).toBe(1); // loss R2
    expect(result.picksProgress[1][3]).toBe(0); // no pts from R2 loss
    expect(result.teamsRemaining).toBe(9);
  });

  it('records a champion winning all 6 rounds with correct cumulative points', async () => {
    // roundPoints per round: 2, 3, 5, 9, 17, 33
    const gs = ['W', 'W', 'W', 'W', 'W', 'W'];
    const allTeams = [{ gameStatus: gs }];
    const [result] = await addTeamProgressforGroup([makeEntry([gs])], allTeams);

    expect(result.picksProgress[0][3]).toBe(2);
    expect(result.picksProgress[1][3]).toBe(3);
    expect(result.picksProgress[2][3]).toBe(5);
    expect(result.picksProgress[3][3]).toBe(9);
    expect(result.picksProgress[4][3]).toBe(17);
    expect(result.picksProgress[5][3]).toBe(33);
    expect(result.teamsRemaining).toBe(10); // champion never lost
  });

  it('accumulates points across multiple picks in the same round', async () => {
    // Two teams both won R1 → picksProgress[0][3] should sum both
    const allTeams = [{ gameStatus: ['W'] }, { gameStatus: ['W'] }];
    const entry = makeEntry([['W'], ['W']]);
    const [result] = await addTeamProgressforGroup([entry], allTeams);

    expect(result.picksProgress[0][0]).toBe(2); // 2 wins
    expect(result.picksProgress[0][3]).toBe(4); // 2 pts × 2 teams
  });

  it('teamsAdvanced counts only current-round winners when a round is in progress', async () => {
    // Team A has played R1 (globalMaxActiveLen=1), Team B has not (null → globalMinActiveLen=0)
    // → globalRoundInProgress = true
    const allTournamentTeams = [
      { gameStatus: ['W'] }, // advanced in R1
      { gameStatus: null },  // waiting for R1
    ];
    const entry = {
      pickNames: [
        { sID: 1, gameStatus: ['W'] }, // won in current round
        { sID: 2, gameStatus: null },  // has not played
      ],
    };
    const [result] = await addTeamProgressforGroup([entry], allTournamentTeams);
    expect(result.teamsAdvanced).toBe(1);
  });

  it('teamsAdvanced equals 0 when no round is in progress (between rounds)', async () => {
    // All alive teams have gameStatus length 1 → same round → no round in progress
    const allTournamentTeams = [
      { gameStatus: ['W'] },
      { gameStatus: ['W'] },
    ];
    const entry = {
      pickNames: [
        { sID: 1, gameStatus: ['W'] },
        { sID: 2, gameStatus: ['W'] },
      ],
    };
    const [result] = await addTeamProgressforGroup([entry], allTournamentTeams);
    expect(result.teamsAdvanced).toBe(0);
  });

  it('builds a 6x4 picksProgress array for each entry', async () => {
    const allTeams = [{ gameStatus: null }];
    const [result] = await addTeamProgressforGroup([makeEntry([null])], allTeams);

    expect(result.picksProgress).toHaveLength(6);
    result.picksProgress.forEach(round => {
      expect(round).toHaveLength(4);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getGroupTeamDetails
// ─────────────────────────────────────────────────────────────────────────────

describe('getGroupTeamDetails', () => {
  let mockViewRepo;
  let mockGameRepo;

  beforeEach(() => {
    mockViewRepo = { getGroupTeams: vi.fn() };
    mockGameRepo = { getAllTournamentDetails: vi.fn(), getAllYearsForGroup: vi.fn() };
    setRepositories(mockViewRepo, mockGameRepo, {}, {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('maps pick IDs to team objects in pickNames', async () => {
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({ teams: TEAMS, allGames: [], regions: [] });
    mockViewRepo.getGroupTeams.mockResolvedValue([
      { teamName: 'Entry A', picks: [1, 3], person: 'Alice', groups: ['Test'] },
    ]);

    const [groupTeams, resultsSoFar] = await getGroupTeamDetails('Test', 2024);

    expect(groupTeams).toHaveLength(1);
    expect(groupTeams[0].pickNames).toHaveLength(2);
    expect(groupTeams[0].pickNames[0]).toMatchObject({ sID: 1, name: 'Duke' });
    expect(groupTeams[0].pickNames[1]).toMatchObject({ sID: 3, name: 'UNC' });
    expect(resultsSoFar).toBe(TEAMS);
  });

  it('filters out pick IDs that match no team (unknown sID)', async () => {
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({ teams: TEAMS, allGames: [], regions: [] });
    mockViewRepo.getGroupTeams.mockResolvedValue([
      { teamName: 'Entry A', picks: [1, 999], person: 'Alice', groups: ['Test'] },
    ]);

    const [groupTeams] = await getGroupTeamDetails('Test', 2024);

    expect(groupTeams[0].pickNames).toHaveLength(1);
    expect(groupTeams[0].pickNames[0].sID).toBe(1);
  });

  it('returns empty groupTeams array when getGroupTeams returns null', async () => {
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({ teams: TEAMS, allGames: [], regions: [] });
    mockViewRepo.getGroupTeams.mockResolvedValue(null);

    const [groupTeams, resultsSoFar] = await getGroupTeamDetails('NonExistent', 2024);

    expect(groupTeams).toEqual([]);
    expect(resultsSoFar).toBe(TEAMS);
  });

  it('skips the DB fetch when prefetchedTeams is provided', async () => {
    mockViewRepo.getGroupTeams.mockResolvedValue([
      { teamName: 'Entry A', picks: [2], person: 'Alice', groups: ['Test'] },
    ]);

    const [groupTeams] = await getGroupTeamDetails('Test', 2024, TEAMS);

    expect(mockGameRepo.getAllTournamentDetails).not.toHaveBeenCalled();
    expect(groupTeams[0].pickNames[0]).toMatchObject({ sID: 2, name: 'Kansas' });
  });

  it('preserves all entry fields beyond picks and pickNames', async () => {
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({ teams: TEAMS, allGames: [], regions: [] });
    mockViewRepo.getGroupTeams.mockResolvedValue([
      { teamName: 'My Team', picks: [2], person: 'Family', groups: ['Test'], email: 'bob@test.com' },
    ]);

    const [groupTeams] = await getGroupTeamDetails('Test', 2024);

    const entry = groupTeams[0];
    expect(entry.teamName).toBe('My Team');
    expect(entry.person).toBe('Family');
    expect(entry.email).toBe('bob@test.com');
    expect(entry.picks).toEqual([2]);
  });

  it('maps picks in the same order they appear in the picks array', async () => {
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({ teams: TEAMS, allGames: [], regions: [] });
    mockViewRepo.getGroupTeams.mockResolvedValue([
      { teamName: 'Entry A', picks: [4, 2, 1], person: 'Alice', groups: ['Test'] },
    ]);

    const [groupTeams] = await getGroupTeamDetails('Test', 2024);
    const names = groupTeams[0].pickNames.map(p => p.name);
    expect(names).toEqual(['Gonzaga', 'Kansas', 'Duke']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildFullGridData
// ─────────────────────────────────────────────────────────────────────────────

describe('buildFullGridData', () => {
  let mockViewRepo;
  let mockGameRepo;

  beforeEach(() => {
    mockViewRepo = { getGroupTeams: vi.fn() };
    mockGameRepo = { getAllTournamentDetails: vi.fn(), getAllYearsForGroup: vi.fn() };
    setRepositories(mockViewRepo, mockGameRepo, {}, {});

    // Default: pass entries through and add required ranking fields
    enrichEntriesWithPotentialRankings.mockImplementation(async (entries) =>
      entries.map(e => ({
        ...e,
        totalPoints: e.totalPoints ?? 0,
        possPoints: e.possPoints ?? 0,
        highestPlace: 1,
        ties: 0,
      }))
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('pickNames in groupData are correctly mapped from pick IDs', async () => {
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({ teams: TEAMS, allGames: [], regions: [] });
    mockViewRepo.getGroupTeams.mockResolvedValue([
      { teamName: 'Entry A', picks: [1, 2], person: 'Alice', groups: ['Test'] },
    ]);

    const { groupData } = await buildFullGridData('Test', 2024);

    expect(groupData[0].pickNames).toHaveLength(2);
    expect(groupData[0].pickNames[0]).toMatchObject({ sID: 1, name: 'Duke' });
    expect(groupData[0].pickNames[1]).toMatchObject({ sID: 2, name: 'Kansas' });
  });

  it('pickIndexBySID maps each resolved pick sID to its 1-based position', async () => {
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({ teams: TEAMS, allGames: [], regions: [] });
    mockViewRepo.getGroupTeams.mockResolvedValue([
      { teamName: 'Entry A', picks: [1, 2], person: 'Alice', groups: ['Test'] },
    ]);

    const { groupData } = await buildFullGridData('Test', 2024);

    // fullGrid.ejs renders the 1-based slot number from this map (replaces the
    // old findIndex+1) and uses .has() to decide whether a team was picked.
    expect(groupData[0].pickIndexBySID.get(1)).toBe(1);
    expect(groupData[0].pickIndexBySID.get(2)).toBe(2);
    expect(groupData[0].pickIndexBySID.has(99)).toBe(false);
  });

  it('allTeamsWithPickCounts has the correct pickCount for every team', async () => {
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({
      teams: [{ sID: 1, name: 'Duke' }, { sID: 2, name: 'Kansas' }],
      allGames: [],
      regions: [],
    });
    mockViewRepo.getGroupTeams.mockResolvedValue([
      { teamName: 'Entry A', picks: [1, 2], person: 'Alice', groups: ['Test'] },
      { teamName: 'Entry B', picks: [1],    person: 'Family',   groups: ['Test'] },
    ]);

    const { allTeamsWithPickCounts } = await buildFullGridData('Test', 2024);

    const duke   = allTeamsWithPickCounts.find(t => t.sID === 1);
    const kansas = allTeamsWithPickCounts.find(t => t.sID === 2);
    expect(duke.pickCount).toBe(2);
    expect(kansas.pickCount).toBe(1);
  });

  it('sorts entries by totalPoints descending', async () => {
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({ teams: TEAMS, allGames: [], regions: [] });
    mockViewRepo.getGroupTeams.mockResolvedValue([
      { teamName: 'LowScore',  picks: [1], person: 'Alice', groups: ['Test'] },
      { teamName: 'HighScore', picks: [2], person: 'Family',   groups: ['Test'] },
    ]);
    enrichEntriesWithPotentialRankings.mockImplementation(async (entries) =>
      entries.map(e => ({
        ...e,
        totalPoints: e.teamName === 'HighScore' ? 20 : 5,
        possPoints: 100,
        highestPlace: 1,
        ties: 0,
      }))
    );

    const { groupData } = await buildFullGridData('Test', 2024);

    expect(groupData[0].teamName).toBe('HighScore');
    expect(groupData[1].teamName).toBe('LowScore');
  });

  it('assigns the same rank to tied entries and the next rank accounts for the tie', async () => {
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({ teams: TEAMS, allGames: [], regions: [] });
    mockViewRepo.getGroupTeams.mockResolvedValue([
      { teamName: 'A', picks: [1], person: 'P1', groups: ['Test'] },
      { teamName: 'B', picks: [2], person: 'P2', groups: ['Test'] },
      { teamName: 'C', picks: [3], person: 'P3', groups: ['Test'] },
    ]);
    // A has 30 pts, B and C both have 20 pts → B and C tied for 2nd
    enrichEntriesWithPotentialRankings.mockImplementation(async (entries) =>
      entries.map(e => ({
        ...e,
        totalPoints: e.teamName === 'A' ? 30 : 20,
        possPoints: 100,
        highestPlace: 1,
        ties: 0,
      }))
    );

    const { groupData } = await buildFullGridData('Test', 2024);

    expect(groupData[0].rank).toBe(1);
    expect(groupData[1].rank).toBe(2);
    expect(groupData[2].rank).toBe(2); // tied, same rank — next rank would be 4
  });

  it('rank skips correctly after a 2-way tie (1, 2, 2, 4 — not 1, 2, 2, 3)', async () => {
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({ teams: TEAMS, allGames: [], regions: [] });
    mockViewRepo.getGroupTeams.mockResolvedValue([
      { teamName: 'A', picks: [1], person: 'P1', groups: ['Test'] },
      { teamName: 'B', picks: [2], person: 'P2', groups: ['Test'] },
      { teamName: 'C', picks: [3], person: 'P3', groups: ['Test'] },
      { teamName: 'D', picks: [4], person: 'P4', groups: ['Test'] },
    ]);
    enrichEntriesWithPotentialRankings.mockImplementation(async (entries) =>
      entries.map(e => ({
        ...e,
        totalPoints: e.teamName === 'A' ? 30 : e.teamName === 'D' ? 5 : 20,
        possPoints: 100,
        highestPlace: 1,
        ties: 0,
      }))
    );

    const { groupData } = await buildFullGridData('Test', 2024);

    // A=30 → rank 1, B=20 → rank 2, C=20 → rank 2, D=5 → rank 4 (not 3)
    const byName = Object.fromEntries(groupData.map(e => [e.teamName, e.rank]));
    expect(byName['A']).toBe(1);
    expect(byName['B']).toBe(2);
    expect(byName['C']).toBe(2);
    expect(byName['D']).toBe(4);
  });

  it('all entries tied gives everyone rank 1', async () => {
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({ teams: TEAMS, allGames: [], regions: [] });
    mockViewRepo.getGroupTeams.mockResolvedValue([
      { teamName: 'A', picks: [1], person: 'P1', groups: ['Test'] },
      { teamName: 'B', picks: [2], person: 'P2', groups: ['Test'] },
    ]);
    enrichEntriesWithPotentialRankings.mockImplementation(async (entries) =>
      entries.map(e => ({ ...e, totalPoints: 10, possPoints: 100, highestPlace: 1, ties: 0 }))
    );

    const { groupData } = await buildFullGridData('Test', 2024);

    expect(groupData[0].rank).toBe(1);
    expect(groupData[1].rank).toBe(1);
  });

  it('handles null groupTeams (no entries in group)', async () => {
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({ teams: TEAMS, allGames: [], regions: [] });
    mockViewRepo.getGroupTeams.mockResolvedValue(null);

    const { groupData, allTeamsWithPickCounts } = await buildFullGridData('Empty', 2024);

    expect(groupData).toEqual([]);
    expect(allTeamsWithPickCounts.every(t => t.pickCount === 0)).toBe(true);
  });

  // ─── First Four (FF) column filtering ───────────────────────────────────────
  //
  // Setup: Two FF games.
  //   - Game 64 (unresolved): teams 100 and 200. Picks stored as team1ID (100).
  //   - Game 65 (resolved, winner=300): teams 300 (winner) and 400 (loser).
  //     After resolution, team 300 has both an ff_ doc (isFFDoc=true) and a
  //     canonical doc (isFFDoc=false).
  //
  // Expected grid column behavior:
  //   - Unresolved FF → single combined "TeamA / TeamB" column at team1ID (100).
  //   - Resolved FF → loser (400) excluded; winner's ff_ doc excluded; canonical
  //     doc appears normally.
  //   - Picks for either sID of an unresolved FF team resolve to the combined object.

  describe('First Four (FF) grid column filtering', () => {
    const ffUnresolvedGame = { gameID: 64, round: 0, team1ID: 100, team2ID: 200, winner: null,  nextGameID: 1 };
    const ffResolvedGame   = { gameID: 65, round: 0, team1ID: 300, team2ID: 400, winner: 300,   nextGameID: 2 };

    // ff_ docs for each team in unresolved game
    const ffDoc100 = { sID: 100, seed: 11, regionName: 'East', nameNick: 'TeamA', mascot: 'Dragons', isFFDoc: true };
    const ffDoc200 = { sID: 200, seed: 11, regionName: 'East', nameNick: 'TeamB', mascot: 'Lions',   isFFDoc: true };
    // Resolved FF winner: ff_ doc + canonical doc
    const ffDoc300     = { sID: 300, seed: 16, regionName: 'West', nameNick: 'TeamC', mascot: 'Bears',  isFFDoc: true  };
    const canonDoc300  = { sID: 300, seed: 16, regionName: 'West', nameNick: 'TeamC', mascot: 'Bears',  isFFDoc: false };
    // Resolved FF loser: only ff_ doc
    const ffDoc400     = { sID: 400, seed: 16, regionName: 'West', nameNick: 'TeamD', mascot: 'Eagles', isFFDoc: true  };
    // A normal seeded team for comparison
    const normalTeam   = { sID: 1,   seed: 1,  regionName: 'East', nameNick: 'TopSeed', isFFDoc: false };

    const allTeamsRawFull = [normalTeam, canonDoc300, ffDoc100, ffDoc200, ffDoc300, ffDoc400];
    const allGames = [ffUnresolvedGame, ffResolvedGame];

    beforeEach(() => {
      mockGameRepo.getAllTournamentDetails.mockResolvedValue({ teams: allTeamsRawFull, allGames, regions: [] });
      mockViewRepo.getGroupTeams.mockResolvedValue([]);
    });

    it('unresolved FF game produces a combined column in allTeamsWithPickCounts', async () => {
      const { allTeamsWithPickCounts } = await buildFullGridData('Test', 2024);
      const combined = allTeamsWithPickCounts.find(t => t.sID === 100);
      expect(combined).toBeDefined();
      expect(combined.nameNick).toBe('TeamA / TeamB');
      expect(combined.isFirstFour).toBe(true);
    });

    it('the FF partner sID (200) does not appear as a separate column', async () => {
      const { allTeamsWithPickCounts } = await buildFullGridData('Test', 2024);
      expect(allTeamsWithPickCounts.find(t => t.sID === 200)).toBeUndefined();
    });

    it('resolved FF loser (400) is excluded from grid columns', async () => {
      const { allTeamsWithPickCounts } = await buildFullGridData('Test', 2024);
      expect(allTeamsWithPickCounts.find(t => t.sID === 400)).toBeUndefined();
    });

    it("resolved FF winner's ff_ doc is excluded; canonical doc appears as the column", async () => {
      const { allTeamsWithPickCounts } = await buildFullGridData('Test', 2024);
      const winnerEntries = allTeamsWithPickCounts.filter(t => t.sID === 300);
      expect(winnerEntries).toHaveLength(1);
      expect(winnerEntries[0].isFFDoc).toBe(false);
    });

    it('pick for team1ID of an unresolved FF resolves to combined object in pickNames', async () => {
      mockViewRepo.getGroupTeams.mockResolvedValue([
        { teamName: 'Entry A', picks: [100], person: 'Alice', groups: ['Test'] },
      ]);

      const { groupData } = await buildFullGridData('Test', 2024);
      const pick = groupData[0].pickNames[0];
      expect(pick).toBeDefined();
      expect(pick.nameNick).toBe('TeamA / TeamB');
    });

    it('pick for team2ID of an unresolved FF also resolves to the same combined object', async () => {
      mockViewRepo.getGroupTeams.mockResolvedValue([
        { teamName: 'Entry B', picks: [200], person: 'Family', groups: ['Test'] },
      ]);

      const { groupData } = await buildFullGridData('Test', 2024);
      const pick = groupData[0].pickNames[0];
      expect(pick).toBeDefined();
      expect(pick.nameNick).toBe('TeamA / TeamB');
    });

    it('columns are sorted by seed ascending with the combined FF entry in its correct position', async () => {
      // normalTeam seed=1, combined FF seed=11, resolved winner seed=16
      const { allTeamsWithPickCounts } = await buildFullGridData('Test', 2024);
      const seeds = allTeamsWithPickCounts.map(t => t.seed);
      expect(seeds).toEqual([...seeds].sort((a, b) => a - b));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildGameViewData
// ─────────────────────────────────────────────────────────────────────────────

describe('buildGameViewData', () => {
  let mockViewRepo;
  let mockGameRepo;

  beforeEach(() => {
    mockViewRepo = { getGroupTeams: vi.fn() };
    mockGameRepo = {
      getAllTournamentDetails: vi.fn(),
      getAllYearsForGroup: vi.fn().mockResolvedValue([]),
    };
    setRepositories(mockViewRepo, mockGameRepo, {}, {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('pickNames in groupData are correctly mapped from pick IDs', async () => {
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({
      activeGames: [], teams: TEAMS, regions: [],
    });
    mockViewRepo.getGroupTeams.mockResolvedValue([
      { teamName: 'Entry A', picks: [1, 4], person: 'Alice', groups: ['Test'] },
    ]);

    const { groupData } = await buildGameViewData('Test', 2024);

    expect(groupData[0].pickNames).toHaveLength(2);
    expect(groupData[0].pickNames[0]).toMatchObject({ sID: 1, name: 'Duke' });
    expect(groupData[0].pickNames[1]).toMatchObject({ sID: 4, name: 'Gonzaga' });
  });

  it('filters out unknown pick IDs from pickNames', async () => {
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({
      activeGames: [], teams: TEAMS, regions: [],
    });
    mockViewRepo.getGroupTeams.mockResolvedValue([
      { teamName: 'Entry A', picks: [2, 999], person: 'Alice', groups: ['Test'] },
    ]);

    const { groupData } = await buildGameViewData('Test', 2024);

    expect(groupData[0].pickNames).toHaveLength(1);
    expect(groupData[0].pickNames[0].sID).toBe(2);
  });

  it('adds winnerName to active games that have a winner', async () => {
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({
      activeGames: [
        { gameID: 1, team1ID: 1, team2ID: 2, team1Name: 'Duke', team2Name: 'Kansas', winner: 1 },
        { gameID: 2, team1ID: 3, team2ID: 4, team1Name: 'UNC', team2Name: 'Gonzaga', winner: 4 },
        { gameID: 3, team1ID: 1, team2ID: 3, team1Name: 'Duke', team2Name: 'UNC', winner: null },
      ],
      teams: TEAMS,
      regions: [],
    });
    mockViewRepo.getGroupTeams.mockResolvedValue([]);

    const { enrichedActiveGames } = await buildGameViewData('Test', 2024);

    expect(enrichedActiveGames[0].winnerName).toBe('Duke');   // winner is team1
    expect(enrichedActiveGames[1].winnerName).toBe('Gonzaga'); // winner is team2
    expect(enrichedActiveGames[2].winnerName).toBeUndefined(); // no winner yet
  });

  it('builds conferenceStats counting teams per conference', async () => {
    // conferenceName is now denormalized into schoolRecords and returned by
    // getAllTournamentDetails — no separate school/conference fetch needed.
    const teams = [
      { sID: 1, name: 'Duke',   gameStatus: null, conferenceName: 'ACC' },
      { sID: 2, name: 'Kansas', gameStatus: null, conferenceName: 'ACC' },
      { sID: 3, name: 'UNC',    gameStatus: null, conferenceName: 'Big 12' },
    ];
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({
      activeGames: [], teams, regions: [],
    });
    mockViewRepo.getGroupTeams.mockResolvedValue([]);

    const { conferenceStats } = await buildGameViewData('Test', 2024);

    expect(conferenceStats['ACC']).toBe(2);
    expect(conferenceStats['Big 12']).toBe(1);
  });

  it('passes through espnID, logoUrl, primaryColor from schoolRecords', async () => {
    // These fields are now denormalized into schoolRecords and returned directly
    // by getAllTournamentDetails — no separate allSchools fetch.
    const teams = [{ sID: 1, name: 'Duke', gameStatus: null, espnID: 'espn-duke', logoUrl: 'duke.png', primaryColor: '#003087' }];
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({
      activeGames: [], teams, regions: [],
    });
    mockViewRepo.getGroupTeams.mockResolvedValue([]);

    const { allTeamsRaw } = await buildGameViewData('Test', 2024);

    const duke = allTeamsRaw.find(t => t.sID === 1);
    expect(duke.espnID).toBe('espn-duke');
    expect(duke.logoUrl).toBe('duke.png');
    expect(duke.primaryColor).toBe('#003087');
  });

  it('returns regionNames derived from the regions array', async () => {
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({
      activeGames: [],
      teams: [],
      regions: [
        { regionID: 1, regionName: 'East' },
        { regionID: 2, regionName: 'West' },
      ],
    });
    mockViewRepo.getGroupTeams.mockResolvedValue([]);

    const { regionNames } = await buildGameViewData('Test', 2024);

    expect(regionNames).toEqual(['East', 'West']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calculateMaxPossiblePoints
// ─────────────────────────────────────────────────────────────────────────────
//
// Regression guard for the bug where stale function arguments (findNextGameId,
// getNextFutureGame, getFuturePoints) were passed as the 4th arg to
// calculateEntryPointsAndPaths, causing it to destructure a function reference
// instead of the prebuiltMaps object and crash at teamMap.get(pickId).

describe('calculateMaxPossiblePoints', () => {
  let mockGameRepo;

  beforeEach(() => {
    mockGameRepo = {
      getAllTournamentDetails: vi.fn(),
      getAllYearsForGroup: vi.fn(),
    };
    setRepositories({}, mockGameRepo, {}, {});

    // Default: return a sensible maxPoints value
    calculateEntryPointsAndPaths.mockReturnValue({
      currentPoints: 10,
      maxPoints: 50,
      futureGamePaths: [],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns maxPoints from calculateEntryPointsAndPaths', async () => {
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({
      allGames: [],
      teams: TEAMS,
      regions: [],
    });
    calculateEntryPointsAndPaths.mockReturnValue({ currentPoints: 5, maxPoints: 75, futureGamePaths: [] });

    const result = await calculateMaxPossiblePoints([1, 2], 2024);

    expect(result).toBe(75);
  });

  it('calls calculateEntryPointsAndPaths with exactly (picks, teams, allGames) — no extra args', async () => {
    // This is the regression test for the bug where findNextGameId/getNextFutureGame/getFuturePoints
    // were erroneously passed as the 4th argument (prebuiltMaps), breaking the lookup maps.
    const allGames = [{ gameID: 1, team1ID: 1, team2ID: 2, winner: null, nextGameID: 0 }];
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({ allGames, teams: TEAMS, regions: [] });

    await calculateMaxPossiblePoints([1, 2], 2024);

    expect(calculateEntryPointsAndPaths).toHaveBeenCalledTimes(1);
    const callArgs = calculateEntryPointsAndPaths.mock.calls[0];
    // Must be called with exactly 3 arguments (picks, teams, allGames).
    // A 4th argument (prebuiltMaps) would be undefined or absent — never a function.
    expect(callArgs).toHaveLength(3);
    expect(callArgs[0]).toEqual([1, 2]);   // picks as numbers
    expect(callArgs[1]).toBe(TEAMS);        // teams array
    expect(callArgs[2]).toBe(allGames);     // allGames, not activeGames
  });

  it('filters out non-numeric SIDs before passing picks', async () => {
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({ allGames: [], teams: TEAMS, regions: [] });

    // 'abc' and NaN-producing values must be stripped
    await calculateMaxPossiblePoints(['1', 'abc', '3'], 2024);

    const callArgs = calculateEntryPointsAndPaths.mock.calls[0];
    expect(callArgs[0]).toEqual([1, 3]); // 'abc' filtered out
  });

  it('returns 0 and does not call calculateEntryPointsAndPaths when all SIDs are invalid', async () => {
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({ allGames: [], teams: TEAMS, regions: [] });

    const result = await calculateMaxPossiblePoints(['abc', 'xyz'], 2024);

    expect(result).toBe(0);
    expect(calculateEntryPointsAndPaths).not.toHaveBeenCalled();
  });

  it('coerces string SIDs to numbers for valid picks', async () => {
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({ allGames: [], teams: TEAMS, regions: [] });

    await calculateMaxPossiblePoints(['1', '2', '3'], 2024);

    const callArgs = calculateEntryPointsAndPaths.mock.calls[0];
    expect(callArgs[0]).toEqual([1, 2, 3]);
  });

  it('uses allGames (not activeGames) from getAllTournamentDetails', async () => {
    // allGames includes TBD-slot games; activeGames is a filtered subset.
    // calculateMaxPossiblePoints must pass allGames so future-path tracing works.
    const allGames    = [{ gameID: 1 }, { gameID: 2 }];
    const activeGames = [{ gameID: 1 }];
    mockGameRepo.getAllTournamentDetails.mockResolvedValue({ allGames, activeGames, teams: TEAMS, regions: [] });

    await calculateMaxPossiblePoints([1], 2024);

    const callArgs = calculateEntryPointsAndPaths.mock.calls[0];
    expect(callArgs[2]).toBe(allGames);
    expect(callArgs[2]).not.toBe(activeGames);
  });

  it('throws an error and logs it if repository throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const repoError = new Error('Database down');
    mockGameRepo.getAllTournamentDetails.mockRejectedValue(repoError);

    await expect(calculateMaxPossiblePoints([1, 2], 2024)).rejects.toThrow('Failed to calculate maximum possible points.');

    expect(errorSpy).toHaveBeenCalled();
    const logOutput = JSON.parse(errorSpy.mock.calls[0][0]);
    expect(logOutput.severity).toBe('ERROR');
    expect(logOutput.message).toBe('Error in calculateMaxPossiblePoints service:');
    expect(logOutput.data.message).toBe('Database down');

    errorSpy.mockRestore();
  });
});
