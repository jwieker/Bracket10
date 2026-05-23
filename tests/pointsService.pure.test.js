import {
  removeDuplicateGames,
  calculateTeamFuturePoints,
  getFuturePoints,
  minPoints,
  getHighestPlace,
  calculateEntryPointsAndPaths,
  getNextFutureGame,
  findNextGameId,
} from '../src/services/pointsService.js';
import { TOURNAMENT_ROUNDS } from '../src/config/app.js';

describe('Points Service Pure Functions', () => {
  describe('removeDuplicateGames', () => {
    it('should not remove games when paths do not intersect', () => {
      const futureGames = [
        ['g1', 'g3', 'W'],
        ['g2', 'g4', 'W']
      ];
      const result = removeDuplicateGames(futureGames);
      expect(result).toEqual([
        ['g1', 'g3', 'W'],
        ['g2', 'g4', 'W']
      ]);
    });

    it('should halt paths when two picks meet in the same game', () => {
      const futureGames = [
        ['g1', 'g3', 'W'], // Path A
        ['g2', 'g3', 'W']  // Path B, meets Path A at 'g3'
      ];
      const result = removeDuplicateGames(futureGames);
      expect(result).toEqual([
        ['g1', 'g3', 'W'], // First pick gets to advance
        ['g2']             // Second pick is halted at 'g3'
      ]);
    });

    it('should handle "W" gracefully', () => {
      const futureGames = [
        ['W'],
        ['W']
      ];
      const result = removeDuplicateGames(futureGames);
      expect(result).toEqual([
        ['W'],
        ['W']
      ]);
    });

    it('should handle complex intersections (large test case)', () => {
      const futureGames = [
        ['g1', 'g5', 'g7', 'W'],
        ['g2', 'g5', 'g7', 'W'],
        ['g3', 'g6', 'g7', 'W'],
        ['g4', 'g6', 'g7', 'W']
      ];
      const result = removeDuplicateGames(futureGames);
      expect(result).toEqual([
        ['g1', 'g5', 'g7', 'W'], // 1st gets full path
        ['g2'],                  // 2nd hits 'g5' already taken
        ['g3', 'g6'],            // 3rd hits 'g7' already taken 
        ['g4']                   // 4th hits 'g6' already taken
      ]);
    });
  });

  describe('calculateTeamFuturePoints', () => {
    it('should calculate points based on TOURNAMENT_ROUNDS config, excluding "W"', async () => {
      // Assuming round 1 is points 10, round 2 is points 20...
      const teamGames = ['g1', 'g2', 'W'];
      // index 0 -> Round 1 config
      // index 1 -> Round 2 config
      const expectedPoints = (TOURNAMENT_ROUNDS[1].roundPoints || 0) + (TOURNAMENT_ROUNDS[2].roundPoints || 0);
      const result = calculateTeamFuturePoints(teamGames);
      expect(result).toBe(expectedPoints);
    });

    it('should return 0 for just ["W"]', async () => {
      const result = calculateTeamFuturePoints(['W']);
      expect(result).toBe(0);
    });
  });

  describe('getFuturePoints', () => {
    it('should aggregate points correctly across multiple cleaned paths', async () => {
      const futureGames = [
        ['g1', 'g3', 'W'],
        ['g2', 'g3', 'W'] 
      ];
      // cleaned: path1 = ['g1', 'g3', 'W'], path2 = ['g2']
      // path1 points = R1 + R2
      // path2 points = R1
      const path1Points = (TOURNAMENT_ROUNDS[1].roundPoints || 0) + (TOURNAMENT_ROUNDS[2].roundPoints || 0);
      const path2Points = (TOURNAMENT_ROUNDS[1].roundPoints || 0);
      
      const currentPoints = 10;
      const expectedTotal = currentPoints + path1Points + path2Points;

      const result = getFuturePoints(futureGames, currentPoints);
      expect(result).toBe(expectedTotal);
    });

    // E2 regression: getFuturePoints previously swallowed errors and returned
    // currentPoints, making calculation failures invisible to callers. It now
    // logs context and rethrows.
    it('rethrows on bad input rather than silently returning currentPoints (E2 regression)', () => {
      // Passing null triggers a TypeError in removeDuplicateGames (cannot iterate).
      expect(() => getFuturePoints(null, 42)).toThrow();
    });
  });

  describe('minPoints', () => {
    it('should calculate points only from guaranteed clashing slots', async () => {
      // Scenario: two picks are definitely playing each other in the next game
      const futureGames = [
        ['g1', 'W'],
        ['g1', 'W']
      ];
      // They clash in game 'g1', which is at index 0 (round 1).
      // That means 10 points (or whatever TOURNAMENT_ROUNDS[1].roundPoints is) are totally guaranteed.
      const currentPoints = 20;
      const expectedGuaranteed = currentPoints + (TOURNAMENT_ROUNDS[1].roundPoints || 0);

      const result = minPoints(futureGames, currentPoints);
      expect(result).toBe(expectedGuaranteed);
    });

    it('should calculate zero guaranteed future points if no paths clash immediately', async () => {
      const futureGames = [
        ['g1', 'g3', 'W'],
        ['g2', 'g4', 'W']
      ];
      const result = minPoints(futureGames, 0);
      expect(result).toBe(0);
    });
  });

  describe('getHighestPlace', () => {
    it('should return 1st place if potential unique max is higher than others min guaranteed', async () => {
      const entry1 = { 
        entryID: 1, 
        name: 'Alpha', 
        points: 50, 
        minPoints: 50, 
        picks: [100, 200], 
        futureGames: [['g1', 'g3', 'W'], ['g2', 'g3', 'W']] 
      };
      
      const entry2 = { 
        entryID: 2, 
        name: 'Beta', 
        points: 40, 
        minPoints: 40, 
        picks: [300], 
        futureGames: [['g4', 'W']] 
      };

      const allEntries = [entry1, entry2];
      
      const { highestPlace, ties } = getHighestPlace(entry1, allEntries);
      expect(highestPlace).toBe(1);
      expect(ties).toBe(0);
    });

    it('should rank lower if potential max is worse than another entry guaranteed minimum', async () => {
      const entry1 = { 
        entryID: 1, 
        name: 'Bad Form', 
        points: 10, 
        minPoints: 10, 
        picks: [100], 
        futureGames: [['W']] // Max additional points = 0
      };
      
      const entry2 = { 
        entryID: 2, 
        name: 'The Winner', 
        points: 500, // already massively ahead
        minPoints: 500, 
        picks: [300], 
        futureGames: [['W']] 
      };

      const allEntries = [entry1, entry2];
      
      const { highestPlace, ties } = getHighestPlace(entry1, allEntries);
      // Bad form can at best get 10 points. 'The Winner' guarantees 500. So Bad form is 2nd place.
      expect(highestPlace).toBe(2);
      expect(ties).toBe(0);
    });

    it('should tie if best potential matches another entry minimum', async () => {
      const entry1 = { 
        entryID: 1, 
        name: 'Tie Contender', 
        points: 10, 
        minPoints: 10, 
        picks: [100], 
        futureGames: [['g1', 'W']] // Can get some R1 points
      };
      
      const r1Points = TOURNAMENT_ROUNDS[1].roundPoints || 0;
      
      const entry2 = { 
        entryID: 2, 
        name: 'Holder', 
        points: 10 + r1Points, // Has exactly the max points entry 1 could potentially reach
        minPoints: 10 + r1Points, 
        picks: [], 
        futureGames: [] 
      };

      const allEntries = [entry1, entry2];
      
      const { highestPlace, ties } = getHighestPlace(entry1, allEntries);
      expect(highestPlace).toBe(1); // Still 1st place technically
      expect(ties).toBe(1); // But shares it with 1 other
    });

    it('should handle large simulation comparisons', async () => {
      const r1Points = TOURNAMENT_ROUNDS[1].roundPoints || 0;

      const mainEntry = {
        entryID: 99,
        name: 'Main',
        points: 30,
        minPoints: 30 + r1Points, // Some guaranteed clash points
        picks: [1, 2, 3],
        futureGames: [
          ['g1', 'W'],
          ['g1', 'W'], // Guarantees a win for picking two teams meeting in g1
          ['g2', 'g3', 'W']
        ]
      };

      const allEntries = [mainEntry];
      for (let i = 1; i <= 50; i++) {
        // Generate opponents with varying scores
        allEntries.push({
          entryID: i,
          name: `Opponent ${i}`,
          points: 10 * i,
          minPoints: 10 * i,
          picks: [],
          futureGames: []
        });
      }

      // mainEntry max points unique calculated during test
      const { highestPlace, ties } = getHighestPlace(mainEntry, allEntries);
      // We don't assert the exact place, but ensure it runs cleanly on a large comparison set
      expect(highestPlace).toBeGreaterThanOrEqual(1);
      expect(ties).toBeGreaterThanOrEqual(0);
    });

    it('shared-unique clash: A ties for 1st, not 2nd (was KNOWN FLAW)', async () => {
      // A picks [1] (shared with B). B picks [1, 2]. Teams 1 and 2 meet in g1.
      // B is guaranteed r1Points (clash of 1 vs 2). But if 1 wins, A also gets r1Points → TIE.
      // Correct answer: A ties for 1st (highestPlace=1, ties=1).
      const r1Points = TOURNAMENT_ROUNDS[1].roundPoints || 0;

      const entryA = {
        entryID: 1, name: 'A', points: 0, minPoints: 0,
        picks: [1],
        futureGames: [['g1', 'W']]
      };
      const entryB = {
        entryID: 2, name: 'B', points: 0, minPoints: r1Points,
        picks: [1, 2],
        futureGames: [['g1', 'W'], ['g1', 'W']]
      };

      const { highestPlace, ties } = getHighestPlace(entryA, [entryA, entryB]);
      expect(highestPlace).toBe(1);
      expect(ties).toBe(1);
    });
  });
});

// ─── getHighestPlace — shared-pick clash flaw and edge cases ──────────────────

describe('getHighestPlace — shared-pick clash flaw and edge cases', () => {
  const r1Points = TOURNAMENT_ROUNDS[1].roundPoints || 0;

  it('no shared picks: A correctly ranked below B when B has internal clash', async () => {
    // A has pick 3 (eliminated, no future). B has picks 4 & 5 that clash in g1.
    // A's max = 0. B's relative floor (unique to B) = r1Points. 0 < r1Points → A is 2nd.
    const entryA = {
      entryID: 1, name: 'A', points: 0, minPoints: 0,
      picks: [3],
      futureGames: [[]]
    };
    const entryB = {
      entryID: 2, name: 'B', points: 0, minPoints: r1Points,
      picks: [4, 5],
      futureGames: [['g1', 'W'], ['g1', 'W']]
    };

    const { highestPlace, ties } = getHighestPlace(entryA, [entryA, entryB]);
    expect(highestPlace).toBe(2);
    expect(ties).toBe(0);
  });

  it('three-way comparison: A > B > C by unique picks', async () => {
    const entryA = { entryID: 1, name: 'A', points: 100, minPoints: 100, picks: [10], futureGames: [[]] };
    const entryB = { entryID: 2, name: 'B', points: 50,  minPoints: 50,  picks: [20], futureGames: [[]] };
    const entryC = { entryID: 3, name: 'C', points: 0,   minPoints: 0,   picks: [30], futureGames: [[]] };

    const all = [entryA, entryB, entryC];
    const { highestPlace: placeA, ties: tiesA } = getHighestPlace(entryA, all);
    const { highestPlace: placeB, ties: tiesB } = getHighestPlace(entryB, all);
    const { highestPlace: placeC, ties: tiesC } = getHighestPlace(entryC, all);

    expect(placeA).toBe(1); expect(tiesA).toBe(0);
    expect(placeB).toBe(2); expect(tiesB).toBe(0);
    expect(placeC).toBe(3); expect(tiesC).toBe(0);
  });

  it('single-entry group: no comparisons → 1st with 0 ties', async () => {
    const entry = { entryID: 1, name: 'Solo', points: 10, minPoints: 10, picks: [1], futureGames: [['g1', 'W']] };
    const { highestPlace, ties } = getHighestPlace(entry, [entry]);
    expect(highestPlace).toBe(1);
    expect(ties).toBe(0);
  });

  it('all 4 entries identical picks: all tie for 1st', async () => {
    const makeEntry = (id) => ({
      entryID: id, name: `E${id}`, points: 10, minPoints: 10, picks: [1], futureGames: [['g1', 'W']]
    });
    const all = [makeEntry(1), makeEntry(2), makeEntry(3), makeEntry(4)];
    for (const e of all) {
      const { highestPlace, ties } = getHighestPlace(e, all);
      expect(highestPlace).toBe(1);
      expect(ties).toBe(3);
    }
  });

  it('all-shared-picks: A ranks 2nd when B has higher base points and same future', async () => {
    // A and B share all picks [1, 2] (clash in g1). B already has r1Points; A has 0.
    // Both will earn r1Points from g1. Final: A = r1, B = 2*r1. B wins in all outcomes.
    const entryA = {
      entryID: 1, name: 'A', points: 0, minPoints: r1Points,
      picks: [1, 2],
      futureGames: [['g1', 'W'], ['g1', 'W']]
    };
    const entryB = {
      entryID: 2, name: 'B', points: r1Points, minPoints: r1Points,
      picks: [1, 2],
      futureGames: [['g1', 'W'], ['g1', 'W']]
    };

    const { highestPlace, ties } = getHighestPlace(entryA, [entryA, entryB]);
    expect(highestPlace).toBe(2);
    expect(ties).toBe(0);
  });

  // C5 regression: float-accumulation drift used to cause genuine ties to be
  // miscategorized as the entry "winning" (neither `<` nor `===` fired) because
  // `0.1 + 0.2 !== 0.3` in JS. The epsilon-tolerant compare now treats values
  // within 1e-9 as equal.
  it('detects ties between float-drift-equal totals (C5 regression)', () => {
    // entryA.points = 0.30000000000000004 (the canonical IEEE-754 drift case)
    // entryB.points = 0.3 — mathematically equal, bit-pattern different.
    // With empty futureGames, both `getFuturePoints([], pts)` and `minPoints([], pts)`
    // return `pts` unchanged, so the comparison reduces to the float-drift case.
    const entryA = {
      entryID: 1, name: 'A', points: 0.1 + 0.2, minPoints: 0,
      picks: [1], futureGames: [[]],
    };
    const entryB = {
      entryID: 2, name: 'B', points: 0.3, minPoints: 0,
      picks: [2], futureGames: [[]],
    };

    // Sanity check: these values ARE bit-pattern unequal in JS.
    expect(entryA.points === entryB.points).toBe(false);

    const { highestPlace, ties } = getHighestPlace(entryA, [entryA, entryB]);
    // Without the epsilon fix, ties would be 0 and entryA would silently
    // "win" the comparison. With the fix, the tie is correctly counted.
    expect(highestPlace).toBe(1);
    expect(ties).toBe(1);
  });

  it('minPoints floor: clash-guaranteed points floor bumps unique potential to tie instead of loss', async () => {
    // A has one unique pick with no future (potential=0), but A's minPoints=r1Points
    // because A has two clash picks in g1. Without the floor, A's potentialFromUniquePicks=0
    // and A would be ranked below B. With the floor, potential=r1Points which equals B's
    // relative min → they tie.
    const entryA = {
      entryID: 1, name: 'A', points: 0, minPoints: r1Points,
      picks: [1, 2, 99],  // 1 & 2 clash in g1; 99 is eliminated (no future)
      futureGames: [['g1', 'W'], ['g1', 'W'], []]
    };
    const entryB = {
      entryID: 2, name: 'B', points: 0, minPoints: r1Points,
      picks: [3, 4],  // 3 & 4 clash in g2; no picks shared with A
      futureGames: [['g2', 'W'], ['g2', 'W']]
    };

    const { highestPlace, ties } = getHighestPlace(entryA, [entryA, entryB]);
    // A's unique potential (pick 99 only) = 0, but floor raises it to r1Points.
    // B's relative min (unique picks 3,4) = r1Points. Equal → tie, not a loss.
    expect(highestPlace).toBe(1);
    expect(ties).toBe(1);
  });
});

// ─── Realistic bracket scenarios (prod-like data) ─────────────────────────────
//
// Game IDs mirror the real bracket structure used in integration/e2e tests:
//   Region 1: R1 games 1-8 → R2 games 9-12 → R3 games 13-14 → R4 game 15
//             → R5 game 61 → R6 game 63
//
// Scenario: R1 and R2 of region 1 are complete.
//   - Teams 1, 5, 3 all won R1 (pts=2 each) and R2 (pts=5 each, cumulative).
//   - Teams 16, 12, 14 lost in R1 (pts=0, eliminated).
//   - After R2: team 1 and team 5 are both headed to game 13 (R3 Sweet 16).
//                team 3 is headed to game 14 (R3 Sweet 16, other half).
//
// Point config: R1=2, R2=3, R3=5, R4=9, R5=17, R6=33  (roundPoints, incremental)
//               R1 cumulative=2, R2 cumulative=5  (stored on team.points)
//
describe('Realistic bracket scenarios (prod-like data)', () => {
  // Teams after R2 of region 1
  const allTeams = [
    { sID: 1,  points: 5, gameStatus: ['W', 'W'] }, // won R1 + R2
    { sID: 5,  points: 5, gameStatus: ['W', 'W'] }, // won R1 + R2
    { sID: 3,  points: 5, gameStatus: ['W', 'W'] }, // won R1 + R2
    { sID: 16, points: 0, gameStatus: ['L'] },       // lost R1
    { sID: 12, points: 0, gameStatus: ['L'] },       // lost R1
    { sID: 14, points: 0, gameStatus: ['L'] },       // lost R1
  ];

  // Active/future games (R3 onwards, winner=null). Teams 1 and 5 seeded into game 13.
  const activeGames = [
    { gameID: 13, team1ID: 1,    team2ID: 5,    winner: null, nextGameID: 15 },
    { gameID: 14, team1ID: 3,    team2ID: 7,    winner: null, nextGameID: 15 },
    { gameID: 15, team1ID: null, team2ID: null, winner: null, nextGameID: 61 },
    { gameID: 61, team1ID: null, team2ID: null, winner: null, nextGameID: 63 },
    { gameID: 63, team1ID: null, team2ID: null, winner: null, nextGameID: 0  },
  ];

  describe('calculateEntryPointsAndPaths — possPoints', () => {
    it('correctly computes currentPoints and possPoints for 3 still-active picks', async () => {
      const picks = [1, 5, 3];
      const { currentPoints, maxPoints } = calculateEntryPointsAndPaths(picks, allTeams, activeGames);

      // 5 + 5 + 5 = 15
      expect(currentPoints).toBe(15);

      // After dedup:
      //   team 1: ["W","W",13,15,61,63] → R3(5)+R4(9)+R5(17)+R6(33) = 64
      //   team 5: meets team 1 in game 13 → deduped to ["W","W"] → 0
      //   team 3: ["W","W",14] (15 already seen) → R3(5)
      // possPoints = 15 + 64 + 0 + 5 = 84
      expect(maxPoints).toBe(84);
    });

    it('returns zero currentPoints and possPoints when all picks are eliminated', async () => {
      const picks = [16, 12, 14];
      const { currentPoints, maxPoints } = calculateEntryPointsAndPaths(picks, allTeams, activeGames);
      expect(currentPoints).toBe(0);
      expect(maxPoints).toBe(0);
    });
  });

  describe('best rank (getHighestPlace) — realistic matchup', () => {
    it('ranks active-pick entry 1st and busted entry 2nd with exact place values', async () => {
      const picksA = [1, 5, 3];     // all alive after R2
      const picksB = [16, 12, 14];  // all eliminated in R1

      const { currentPoints: pointsA, futureGamePaths: pathsA } =
        calculateEntryPointsAndPaths(picksA, allTeams, activeGames);
      const { currentPoints: pointsB, futureGamePaths: pathsB } =
        calculateEntryPointsAndPaths(picksB, allTeams, activeGames);

      const entryA = { entryID: 1, name: 'Active Bracket', points: pointsA, picks: picksA, futureGames: pathsA };
      const entryB = { entryID: 2, name: 'All Busted',     points: pointsB, picks: picksB, futureGames: pathsB };

      entryA.minPoints = minPoints(pathsA, pointsA);
      entryB.minPoints = minPoints(pathsB, pointsB);

      // Team 1 and team 5 are both heading to game 13 → guaranteed R3 clash points (5)
      // minPoints_A = 15 + 5 = 20; minPoints_B = 0
      expect(entryA.minPoints).toBe(20);
      expect(entryB.minPoints).toBe(0);

      const allEntries = [entryA, entryB];
      const { highestPlace: placeA, ties: tiesA } = getHighestPlace(entryA, allEntries);
      const { highestPlace: placeB, ties: tiesB } = getHighestPlace(entryB, allEntries);

      // A can reach 84; B's max is 0 which is < A's minPoints(20) → B is definitively 2nd
      expect(placeA).toBe(1);
      expect(tiesA).toBe(0);
      expect(placeB).toBe(2);
      expect(tiesB).toBe(0);
    });

    it('reports a tie when two entries share all picks and have the same trajectory', async () => {
      const picks = [1, 5, 3];

      const { currentPoints: pts, futureGamePaths: paths } =
        calculateEntryPointsAndPaths(picks, allTeams, activeGames);

      const entryX = { entryID: 10, name: 'Twin X', points: pts, picks, futureGames: paths };
      const entryY = { entryID: 11, name: 'Twin Y', points: pts, picks, futureGames: paths };

      entryX.minPoints = minPoints(paths, pts);
      entryY.minPoints = minPoints(paths, pts);

      const allEntries = [entryX, entryY];
      const { highestPlace: placeX, ties: tiesX } = getHighestPlace(entryX, allEntries);
      const { highestPlace: placeY, ties: tiesY } = getHighestPlace(entryY, allEntries);

      // Identical picks → no unique future potential for either → they tie at 1st
      expect(placeX).toBe(1);
      expect(tiesX).toBe(1);
      expect(placeY).toBe(1);
      expect(tiesY).toBe(1);
    });
  });
});

// ─── getNextFutureGame ────────────────────────────────────────────────────────

describe('getNextFutureGame', () => {
  const games = [
    { gameID: 13, nextGameID: 15 },
    { gameID: 15, nextGameID: 61 },
    { gameID: 61, nextGameID: 63 },
    { gameID: 63, nextGameID: 0 },  // championship — terminal
  ];

  it('terminates at championship (nextGameID = 0) and returns accumulated path', () => {
    // Starting at game 61 with path already containing prior IDs
    const result = getNextFutureGame(['W', 'W', 13, 15, 61], games, 61);
    // 61's nextGameID is 63, 63's nextGameID is 0 → stop. Path gets 63 appended.
    expect(result).toEqual(['W', 'W', 13, 15, 61, 63]);
  });

  it('returns null when the starting gameID is not found', () => {
    const result = getNextFutureGame(['W', 99], games, 99);
    expect(result).toBeNull();
  });

  it('builds the full chain from an early game to the championship', () => {
    const result = getNextFutureGame(['W', 'W', 13], games, 13);
    expect(result).toEqual(['W', 'W', 13, 15, 61, 63]);
  });

  it('works correctly with a Map as well as an array (both code paths)', () => {
    const gamesMap = new Map(games.map(g => [g.gameID, g]));
    const resultArr = getNextFutureGame(['W', 13], games, 13);
    const resultMap = getNextFutureGame(['W', 13], gamesMap, 13);
    expect(resultArr).toEqual(resultMap);
  });

  it('returns the path unchanged when given a single-game bracket (nextGameID = 0)', () => {
    const singleGame = [{ gameID: 1, nextGameID: 0 }];
    const result = getNextFutureGame([1], singleGame, 1);
    expect(result).toEqual([1]);
  });

  // C4 regression: a corrupted nextGameID that points back to itself (or any
  // cycle) used to recurse forever and stack-overflow. It must now return the
  // accumulated path and log an error rather than hang.
  it('detects a self-referential nextGameID cycle and exits without infinite recursion', () => {
    const corrupted = [{ gameID: 5, nextGameID: 5 }];
    const result = getNextFutureGame([], corrupted, 5);
    // The visited-set guard kicks in once we revisit 5 after appending it once.
    expect(result).toEqual([5]);
  });

  it('detects a multi-node cycle (A → B → A) without recursion', () => {
    const cyclicChain = [
      { gameID: 1, nextGameID: 2 },
      { gameID: 2, nextGameID: 1 },
    ];
    const result = getNextFutureGame([], cyclicChain, 1);
    // Walk: visit 1 (collect 2), visit 2 (collect 1), then 1 is already visited → break.
    expect(result).toEqual([2, 1]);
  });

  it('caps traversal at MAX_FUTURE_GAME_DEPTH (10) on a pathologically long chain', () => {
    // 15 games linked tail-to-head; final nextGameID intentionally non-zero so
    // only the depth cap can terminate traversal.
    const longChain = Array.from({ length: 15 }, (_, i) => ({
      gameID: i + 1,
      nextGameID: i + 2, // 1→2, 2→3, ..., 15→16 (16 never exists)
    }));
    const result = getNextFutureGame([], longChain, 1);
    // After MAX_FUTURE_GAME_DEPTH=10 iterations we should have collected exactly 10 nextUps.
    expect(result).toHaveLength(10);
  });
});

// ─── findNextGameId ───────────────────────────────────────────────────────────

describe('findNextGameId', () => {
  const activeGames = [
    { gameID: 5, team1ID: 1, team2ID: 2, winner: null },
    { gameID: 6, team1ID: 3, team2ID: 4, winner: null },
    { gameID: 9, team1ID: 5, team2ID: 6, winner: 5 },  // already decided
  ];

  it('returns the gameID when the team is team1ID of an unplayed game', () => {
    expect(findNextGameId(1, activeGames)).toBe(5);
  });

  it('returns the gameID when the team is team2ID of an unplayed game', () => {
    expect(findNextGameId(4, activeGames)).toBe(6);
  });

  it('returns -1 when the team has no unplayed game (already decided)', () => {
    // team 5 is in game 9 but it already has a winner
    expect(findNextGameId(5, activeGames)).toBe(-1);
  });

  it('returns -1 when the team is not in any game', () => {
    expect(findNextGameId(99, activeGames)).toBe(-1);
  });

  it('returns -1 for an empty games list', () => {
    expect(findNextGameId(1, [])).toBe(-1);
  });
});

// ─── First Four (FF) scenarios ───────────────────────────────────────────────
//
// Setup: FF game 64 (round 0) feeds into R1 game 5.
//   - Team 100 (FF slot 1) and team 200 (FF slot 2) play FF game 64.
//   - Winner of game 64 plays team 50 in R1 game 5.
//   - R1 game 5 feeds into R2 game 9 → R3 game 13 → R4 game 15 → R5 game 61 → R6 game 63.
//
// Expected behavior:
//   - FF game (round 0) is NOT included in future scoring paths — it awards 0 points.
//   - An FF team's possible points = same as any normal R1 team (69 max from R1 onward).
//   - Picking an FF team and team 50 (the other R1 slot) produces two independent paths
//     that do NOT clash at game 5 via removeDuplicateGames, since the FF team's path
//     starts at game 5 (not at game 64).
//
describe('First Four (FF) scenarios', () => {
  const ffGame = { gameID: 64, round: 0, team1ID: 100, team2ID: 200, winner: null, nextGameID: 5, nextGameSpot: 1 };
  const r1Game = { gameID: 5,  round: 1, team1ID: null, team2ID: 50,  winner: null, nextGameID: 9  };
  const r2Game = { gameID: 9,  round: 2, team1ID: null, team2ID: null, winner: null, nextGameID: 13 };
  const r3Game = { gameID: 13, round: 3, team1ID: null, team2ID: null, winner: null, nextGameID: 15 };
  const r4Game = { gameID: 15, round: 4, team1ID: null, team2ID: null, winner: null, nextGameID: 61 };
  const r5Game = { gameID: 61, round: 5, team1ID: null, team2ID: null, winner: null, nextGameID: 63 };
  const r6Game = { gameID: 63, round: 6, team1ID: null, team2ID: null, winner: null, nextGameID: 0  };

  const activeGames = [ffGame, r1Game, r2Game, r3Game, r4Game, r5Game, r6Game];

  // FF team before FF resolves: gameStatus=[], points=null
  const ffTeam1 = { sID: 100, points: null, gameStatus: [] };
  const ffTeam2 = { sID: 200, points: null, gameStatus: [] };
  // Regular R1 team in the same FF-fed slot
  const r1Team  = { sID: 50,  points: null, gameStatus: [] };

  const allTeams = [ffTeam1, ffTeam2, r1Team];

  it('FF team has 0 current points before FF resolves', () => {
    const { currentPoints } = calculateEntryPointsAndPaths([100], allTeams, activeGames);
    expect(currentPoints).toBe(0);
  });

  it('FF team possible points equal a normal R1 team (FF game adds no extra points)', () => {
    const { maxPoints: ffMax } = calculateEntryPointsAndPaths([100], allTeams, activeGames);
    const { maxPoints: r1Max } = calculateEntryPointsAndPaths([50],  allTeams, activeGames);
    expect(ffMax).toBe(r1Max);
  });

  it('FF team future path starts at the R1 game (game 5), not the FF game (game 64)', () => {
    const { futureGamePaths } = calculateEntryPointsAndPaths([100], allTeams, activeGames);
    expect(futureGamePaths[0][0]).toBe(5);   // first game in path is R1 game 5
    expect(futureGamePaths[0]).not.toContain(64); // FF game 64 must not appear in path
  });

  it('picking an FF team and the R1 opponent produces two independent non-clashing paths', () => {
    // User picks team 100 (FF) and team 50 (R1 opponent). Both should have full independent paths
    // because team 100's path starts at game 5 (same as team 50's), but removeDuplicateGames
    // should NOT cut team 50's path — they are the same game entry point but different sIDs.
    // Actually: both paths start at game 5, so removeDuplicateGames WILL see game 5 from both.
    // This is correct — they are opponents in game 5, only one can win.
    const { futureGamePaths, maxPoints } = calculateEntryPointsAndPaths([100, 50], allTeams, activeGames);
    // Both paths should start at game 5 (FF game excluded from both)
    expect(futureGamePaths[0][0]).toBe(5);
    expect(futureGamePaths[1][0]).toBe(5);
    // removeDuplicateGames will cut the second path at game 5 (already seen) — correct clash behavior
    // maxPoints should equal a single R1 team's max (not double, since they clash in game 5)
    const { maxPoints: singleMax } = calculateEntryPointsAndPaths([100], allTeams, activeGames);
    expect(maxPoints).toBe(singleMax);
  });

  it('FF game (round 0) is excluded from path even when it is the first active game', () => {
    // Regression: before the fix, the path for an FF team would include game 64, causing
    // calculateTeamFuturePoints to apply R1 points (2 pts) to the FF game — awarding
    // phantom points for a game that should score zero.
    const { futureGamePaths } = calculateEntryPointsAndPaths([100], allTeams, activeGames);
    expect(futureGamePaths[0]).not.toContain(64);
  });

  it('both FF slot teams have identical possible points (mirror of two regular R1 teams)', () => {
    const { maxPoints: max1 } = calculateEntryPointsAndPaths([100], allTeams, activeGames);
    const { maxPoints: max2 } = calculateEntryPointsAndPaths([200], allTeams, activeGames);
    expect(max1).toBe(max2);
  });

  it('regression: FF winner has correct possible points even when FF gameID is higher than R1 gameID', () => {
    // This replicates the real bracket where FF games (IDs 64+) would overwrite R1 games (IDs 1-32)
    // in the internal team-to-game map if built purely by gameID.
    const resolvedFF = { gameID: 64, round: 0, team1ID: 100, team2ID: 200, winner: 100, nextGameID: 5 };
    const unresolvedR1 = { gameID: 5, round: 1, team1ID: 100, team2ID: 50, winner: null, nextGameID: 0 };
    
    // Explicitly order them so gameID 64 is last
    const games = [unresolvedR1, resolvedFF];
    const teams = [{ sID: 100, points: 0, gameStatus: [] }];
    
    const { maxPoints } = calculateEntryPointsAndPaths([100], teams, games);
    // Should get points for the unresolved R1 game (2 points)
    expect(maxPoints).toBe(2);
  });
});

// ─── calculateEntryPointsAndPaths — edge cases ───────────────────────────────

describe('calculateEntryPointsAndPaths — edge cases', () => {
  it('skips a pick whose sID is not in allTeams and gives it an empty future path', () => {
    const picks = [1, 999]; // 999 doesn't exist
    const allTeams = [{ sID: 1, points: 2, gameStatus: ['W'] }];
    const activeGames = [{ gameID: 9, team1ID: 1, team2ID: 2, winner: null, nextGameID: 0 }];

    const { currentPoints, futureGamePaths } = calculateEntryPointsAndPaths(picks, allTeams, activeGames);

    expect(currentPoints).toBe(2);               // only team 1 contributes
    expect(futureGamePaths).toHaveLength(2);      // one path per pick
    expect(futureGamePaths[1]).toEqual([]);        // missing team → empty path
  });

  it('returns zero currentPoints and all-empty paths when every pick is missing', () => {
    const { currentPoints, maxPoints, futureGamePaths } =
      calculateEntryPointsAndPaths([88, 99], [], []);

    expect(currentPoints).toBe(0);
    expect(maxPoints).toBe(0);
    expect(futureGamePaths).toEqual([[], []]);
  });

  it('eliminated team contributes its cumulative points but an empty future path', () => {
    const picks = [1];
    const allTeams = [{ sID: 1, points: 5, gameStatus: ['W', 'L'] }]; // eliminated in R2
    const activeGames = [];

    const { currentPoints, maxPoints, futureGamePaths } = calculateEntryPointsAndPaths(picks, allTeams, activeGames);

    expect(currentPoints).toBe(5);
    expect(maxPoints).toBe(5);    // no future points
    expect(futureGamePaths[0]).toEqual([]);
  });
});

// ─── getHighestPlace — early-exit bounds optimization ───────────────────────
//
// When entries have `maxPoints` pre-computed, getHighestPlace can skip the
// expensive unique-pick analysis for pairs where absolute bounds already
// determine the outcome:
//   - If A.maxPoints < B.points → B definitely beats A (A's ceiling < B's floor)
//   - If A.points > B.maxPoints → A definitely beats B (A's floor > B's ceiling)
//
// These tests verify that the early-exit paths produce identical results to
// the full unique-pick analysis.
//
describe('getHighestPlace — early-exit bounds optimization', () => {
  const r1Points = TOURNAMENT_ROUNDS[1].roundPoints || 0;
  const r2Points = TOURNAMENT_ROUNDS[2].roundPoints || 0;

  it('early exit: A.maxPoints < B.points → B definitely beats A', () => {
    // A has 10 current points and maxPoints=15 (some future games).
    // B has 20 current points (already above A's ceiling) and no future.
    // The early exit should detect this without computing unique picks.
    const entryA = {
      entryID: 1, name: 'A', points: 10, maxPoints: 15, minPoints: 10,
      picks: [1], futureGames: [['g1', 'W']]
    };
    const entryB = {
      entryID: 2, name: 'B', points: 20, maxPoints: 20, minPoints: 20,
      picks: [2], futureGames: [[]]
    };

    const { highestPlace, ties } = getHighestPlace(entryA, [entryA, entryB]);
    expect(highestPlace).toBe(2);
    expect(ties).toBe(0);
  });

  it('early exit: A.points > B.maxPoints → A definitely beats B', () => {
    // A has 50 current points (floor). B has maxPoints=30 (ceiling).
    // A's floor exceeds B's ceiling, so A wins in every scenario.
    const entryA = {
      entryID: 1, name: 'A', points: 50, maxPoints: 50, minPoints: 50,
      picks: [1], futureGames: [[]]
    };
    const entryB = {
      entryID: 2, name: 'B', points: 10, maxPoints: 30, minPoints: 10,
      picks: [2], futureGames: [['g1', 'g2', 'W']]
    };

    const { highestPlace, ties } = getHighestPlace(entryA, [entryA, entryB]);
    expect(highestPlace).toBe(1);
    expect(ties).toBe(0);
  });

  it('no early exit: overlapping bounds fall through to full analysis', () => {
    // A: points=10, maxPoints=20. B: points=15, maxPoints=25.
    // A.maxPoints (20) >= B.points (15) and A.points (10) <= B.maxPoints (25).
    // Neither early exit triggers — full unique-pick analysis must run.
    const entryA = {
      entryID: 1, name: 'A', points: 10, maxPoints: 10 + r1Points + r2Points, minPoints: 10,
      picks: [1], futureGames: [['g1', 'g2', 'W']]
    };
    const entryB = {
      entryID: 2, name: 'B', points: 10 + r1Points, maxPoints: 10 + r1Points + r1Points + r2Points, minPoints: 10 + r1Points,
      picks: [2], futureGames: [['g3', 'g4', 'W']]
    };

    const { highestPlace, ties } = getHighestPlace(entryA, [entryA, entryB]);
    // A's max (10+r1+r2) vs B's min (10+r1). A can potentially beat B.
    expect(highestPlace).toBe(1);
    expect(ties).toBe(0);
  });

  it('graceful fallback: absent maxPoints skips early exit, produces correct result', () => {
    // Entries without maxPoints (as in older test fixtures) should still work
    // correctly — the optimization is simply bypassed.
    const entryA = {
      entryID: 1, name: 'A', points: 10, minPoints: 10,
      picks: [1], futureGames: [['g1', 'W']]
    };
    const entryB = {
      entryID: 2, name: 'B', points: 500, minPoints: 500,
      picks: [2], futureGames: [[]]
    };

    const { highestPlace, ties } = getHighestPlace(entryA, [entryA, entryB]);
    expect(highestPlace).toBe(2);
    expect(ties).toBe(0);
  });

  it('results with maxPoints match results without maxPoints', () => {
    // Property test: adding maxPoints should not change the ranking outcome.
    const baseEntries = [
      { entryID: 1, name: 'A', points: 30, minPoints: 30, picks: [1, 2], futureGames: [['g1', 'W'], ['g1', 'W']] },
      { entryID: 2, name: 'B', points: 20, minPoints: 20, picks: [3],    futureGames: [['g2', 'g3', 'W']] },
      { entryID: 3, name: 'C', points: 50, minPoints: 50, picks: [4],    futureGames: [[]] },
    ];

    // Without maxPoints
    const withoutMax = baseEntries.map(e => {
      const { highestPlace, ties } = getHighestPlace(e, baseEntries);
      return { entryID: e.entryID, highestPlace, ties };
    });

    // With maxPoints added
    const entriesWithMax = baseEntries.map(e => ({
      ...e,
      maxPoints: getFuturePoints(e.futureGames, e.points),
    }));
    const withMax = entriesWithMax.map(e => {
      const { highestPlace, ties } = getHighestPlace(e, entriesWithMax);
      return { entryID: e.entryID, highestPlace, ties };
    });

    expect(withMax).toEqual(withoutMax);
  });

  it('early exit handles multi-entry group with mixed clear-cut and uncertain pairs', () => {
    // 4 entries: some pairs are clear-cut (early exit), others need full analysis.
    const entryA = {
      entryID: 1, name: 'Leader', points: 100, maxPoints: 100, minPoints: 100,
      picks: [1], futureGames: [[]]
    };
    const entryB = {
      entryID: 2, name: 'Contender', points: 80, maxPoints: 95, minPoints: 80,
      picks: [2], futureGames: [['g1', 'g2', 'W']]
    };
    const entryC = {
      entryID: 3, name: 'Longshot', points: 20, maxPoints: 50, minPoints: 20,
      picks: [3], futureGames: [['g3', 'g4', 'g5', 'W']]
    };
    const entryD = {
      entryID: 4, name: 'Busted', points: 5, maxPoints: 5, minPoints: 5,
      picks: [4], futureGames: [[]]
    };

    const all = [entryA, entryB, entryC, entryD];

    // Leader: 100 pts, no future. Beats everyone via early exit (100 > 95, 50, 5).
    const { highestPlace: placeA } = getHighestPlace(entryA, all);
    expect(placeA).toBe(1);

    // Contender: max 95, can't beat Leader (95 < 100). But beats C and D.
    const { highestPlace: placeB } = getHighestPlace(entryB, all);
    expect(placeB).toBe(2);

    // Longshot: max 50, can't beat Leader (50 < 100) or Contender (50 < 80).
    const { highestPlace: placeC } = getHighestPlace(entryC, all);
    expect(placeC).toBe(3);

    // Busted: max 5, loses to everyone.
    const { highestPlace: placeD } = getHighestPlace(entryD, all);
    expect(placeD).toBe(4);
  });

  it('early exit with equal boundary values falls through to full analysis', () => {
    // A.maxPoints == B.points → cannot shortcut, must do full analysis.
    // futureGames must be consistent with maxPoints: R1(2)+R2(3)+R3(5)=10 future pts.
    const r1 = TOURNAMENT_ROUNDS[1].roundPoints || 0;
    const r2 = TOURNAMENT_ROUNDS[2].roundPoints || 0;
    const r3 = TOURNAMENT_ROUNDS[3].roundPoints || 0;
    const futurePts = r1 + r2 + r3; // 10

    const entryA = {
      entryID: 1, name: 'A', points: 20, maxPoints: 20 + futurePts, minPoints: 20,
      picks: [1], futureGames: [['g1', 'g2', 'g3', 'W']]
    };
    const entryB = {
      entryID: 2, name: 'B', points: 20 + futurePts, maxPoints: 20 + futurePts, minPoints: 20 + futurePts,
      picks: [2], futureGames: [[]]
    };

    // A.maxPoints (30) == B.points (30) → no early exit (not strictly less).
    // Full analysis: A's unique max = getFuturePoints([['g1','g2','g3','W']], 20) = 30.
    // B's unique min = minPoints([[]], 30) = 30. Equal → tie.
    const { highestPlace, ties } = getHighestPlace(entryA, [entryA, entryB]);
    expect(highestPlace).toBe(1);
    expect(ties).toBe(1);
  });
});
