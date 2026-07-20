import {
  getHighestPlace,
  minPoints,
  getFuturePoints,
} from '../src/utils/pointsUtils.js';
import {
  calculateEntryPointsAndPaths,
  enrichEntriesWithPotentialRankings,
  getNextFutureGame,
  findNextGameId,
} from '../src/services/pointsService.js';
import { TOURNAMENT_ROUNDS } from '../src/config/app.js';

const R = (n) => TOURNAMENT_ROUNDS[n].roundPoints || 0;

describe('Points Service Pure Functions', () => {
  describe('getFuturePoints', () => {
    it('aggregates points across two paths that collide at round 2', () => {
      // path2 advances through g2 (R1) then collides with path1 at g3, so it
      // stops contributing after round 1. path1 scores R1 + R2.
      const futureGames = [
        ['g1', 'g3', 'W'],
        ['g2', 'g3', 'W'],
      ];
      const currentPoints = 10;
      expect(getFuturePoints(futureGames, currentPoints)).toBe(
        currentPoints + R(1) + R(2) + R(1),
      );
    });

    it('does not double-count games shared across paths', () => {
      // Without dedup, g5 and g7 would be credited multiple times.
      const futureGames = [
        ['g1', 'g5', 'g7', 'W'],
        ['g2', 'g5', 'g7', 'W'],
        ['g3', 'g6', 'g7', 'W'],
        ['g4', 'g6', 'g7', 'W'],
      ];
      // path1: R1 + R2 + R3. path2 collides at g5 -> R1 only.
      // path3: R1 + R2 (g7 already credited by path1). path4 collides at g6 -> R1 only.
      const expected = R(1) + R(2) + R(3) + R(1) + (R(1) + R(2)) + R(1);
      expect(getFuturePoints(futureGames, 0)).toBe(expected);
    });

    it('treats "W" slots as zero-point but does not stop the path', () => {
      // W means "already won and credited" — skip without halting traversal,
      // so the later g1 still scores.
      const futureGames = [['W', 'g1', 'W']];
      expect(getFuturePoints(futureGames, 0)).toBe(R(2));
    });

    it('returns currentPoints when futureGames is empty', () => {
      expect(getFuturePoints([], 42)).toBe(42);
    });

    it('rethrows on bad input rather than silently returning currentPoints', () => {
      // Passing a non-iterable triggers a TypeError inside the try block.
      // The catch logs context and rethrows so the boundary can decide whether
      // to fail the request or skip the entry — never silently corrupt ranks.
      expect(() => getFuturePoints(null, 7)).toThrow();
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
        ['g1', 'W'],
      ];
      // They clash in game 'g1', which is at index 0 (round 1).
      // That means 10 points (or whatever TOURNAMENT_ROUNDS[1].roundPoints is) are totally guaranteed.
      const currentPoints = 20;
      const expectedGuaranteed =
        currentPoints + (TOURNAMENT_ROUNDS[1].roundPoints || 0);

      const result = minPoints(futureGames, currentPoints);
      expect(result).toBe(expectedGuaranteed);
    });

    it('should calculate zero guaranteed future points if no paths clash immediately', async () => {
      const futureGames = [
        ['g1', 'g3', 'W'],
        ['g2', 'g4', 'W'],
      ];
      const result = minPoints(futureGames, 0);
      expect(result).toBe(0);
    });

    it('should calculate cascading clashes exactly when sortedGames and incomingGames are provided', () => {
      const futureGames = [
        ['W', 9, 13, 15],
        ['W', 9, 13, 15],
        ['W', 'W', 13, 15],
      ];

      const sortedGames = [
        { gameID: 1, round: 1, nextGameID: 9 },
        { gameID: 2, round: 1, nextGameID: 9 },
        { gameID: 9, round: 2, nextGameID: 13 },
        { gameID: 10, round: 2, nextGameID: 13 },
        { gameID: 13, round: 3, nextGameID: 15 },
        { gameID: 15, round: 4, nextGameID: 0 },
      ];

      const incomingGames = new Map([
        [9, [1, 2]],
        [13, [9, 10]],
        [15, [13]],
      ]);

      const result = minPoints(futureGames, 10, sortedGames, incomingGames);
      expect(result).toBe(10 + 3 + 5);
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
        futureGames: [
          ['g1', 'g3', 'W'],
          ['g2', 'g3', 'W'],
        ],
      };

      const entry2 = {
        entryID: 2,
        name: 'Beta',
        points: 40,
        minPoints: 40,
        picks: [300],
        futureGames: [['g4', 'W']],
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
        futureGames: [['W']], // Max additional points = 0
      };

      const entry2 = {
        entryID: 2,
        name: 'The Winner',
        points: 500, // already massively ahead
        minPoints: 500,
        picks: [300],
        futureGames: [['W']],
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
        futureGames: [['g1', 'W']], // Can get some R1 points
      };

      const r1Points = TOURNAMENT_ROUNDS[1].roundPoints || 0;

      const entry2 = {
        entryID: 2,
        name: 'Holder',
        points: 10 + r1Points, // Has exactly the max points entry 1 could potentially reach
        minPoints: 10 + r1Points,
        picks: [],
        futureGames: [],
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
          ['g2', 'g3', 'W'],
        ],
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
          futureGames: [],
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
        entryID: 1,
        name: 'A',
        points: 0,
        minPoints: 0,
        picks: [1],
        futureGames: [['g1', 'W']],
      };
      const entryB = {
        entryID: 2,
        name: 'B',
        points: 0,
        minPoints: r1Points,
        picks: [1, 2],
        futureGames: [
          ['g1', 'W'],
          ['g1', 'W'],
        ],
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
      entryID: 1,
      name: 'A',
      points: 0,
      minPoints: 0,
      picks: [3],
      futureGames: [[]],
    };
    const entryB = {
      entryID: 2,
      name: 'B',
      points: 0,
      minPoints: r1Points,
      picks: [4, 5],
      futureGames: [
        ['g1', 'W'],
        ['g1', 'W'],
      ],
    };

    const { highestPlace, ties } = getHighestPlace(entryA, [entryA, entryB]);
    expect(highestPlace).toBe(2);
    expect(ties).toBe(0);
  });

  it('three-way comparison: A > B > C by unique picks', async () => {
    const entryA = {
      entryID: 1,
      name: 'A',
      points: 100,
      minPoints: 100,
      picks: [10],
      futureGames: [[]],
    };
    const entryB = {
      entryID: 2,
      name: 'B',
      points: 50,
      minPoints: 50,
      picks: [20],
      futureGames: [[]],
    };
    const entryC = {
      entryID: 3,
      name: 'C',
      points: 0,
      minPoints: 0,
      picks: [30],
      futureGames: [[]],
    };

    const all = [entryA, entryB, entryC];
    const { highestPlace: placeA, ties: tiesA } = getHighestPlace(entryA, all);
    const { highestPlace: placeB, ties: tiesB } = getHighestPlace(entryB, all);
    const { highestPlace: placeC, ties: tiesC } = getHighestPlace(entryC, all);

    expect(placeA).toBe(1);
    expect(tiesA).toBe(0);
    expect(placeB).toBe(2);
    expect(tiesB).toBe(0);
    expect(placeC).toBe(3);
    expect(tiesC).toBe(0);
  });

  it('single-entry group: no comparisons → 1st with 0 ties', async () => {
    const entry = {
      entryID: 1,
      name: 'Solo',
      points: 10,
      minPoints: 10,
      picks: [1],
      futureGames: [['g1', 'W']],
    };
    const { highestPlace, ties } = getHighestPlace(entry, [entry]);
    expect(highestPlace).toBe(1);
    expect(ties).toBe(0);
  });

  it('all 4 entries identical picks: all tie for 1st', async () => {
    const makeEntry = (id) => ({
      entryID: id,
      name: `E${id}`,
      points: 10,
      minPoints: 10,
      picks: [1],
      futureGames: [['g1', 'W']],
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
      entryID: 1,
      name: 'A',
      points: 0,
      minPoints: r1Points,
      picks: [1, 2],
      futureGames: [
        ['g1', 'W'],
        ['g1', 'W'],
      ],
    };
    const entryB = {
      entryID: 2,
      name: 'B',
      points: r1Points,
      minPoints: r1Points,
      picks: [1, 2],
      futureGames: [
        ['g1', 'W'],
        ['g1', 'W'],
      ],
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
      entryID: 1,
      name: 'A',
      points: 0.1 + 0.2,
      minPoints: 0,
      picks: [1],
      futureGames: [[]],
    };
    const entryB = {
      entryID: 2,
      name: 'B',
      points: 0.3,
      minPoints: 0,
      picks: [2],
      futureGames: [[]],
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
      entryID: 1,
      name: 'A',
      points: 0,
      minPoints: r1Points,
      picks: [1, 2, 99], // 1 & 2 clash in g1; 99 is eliminated (no future)
      futureGames: [['g1', 'W'], ['g1', 'W'], []],
    };
    const entryB = {
      entryID: 2,
      name: 'B',
      points: 0,
      minPoints: r1Points,
      picks: [3, 4], // 3 & 4 clash in g2; no picks shared with A
      futureGames: [
        ['g2', 'W'],
        ['g2', 'W'],
      ],
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
    { sID: 1, points: 5, gameStatus: ['W', 'W'] }, // won R1 + R2
    { sID: 5, points: 5, gameStatus: ['W', 'W'] }, // won R1 + R2
    { sID: 3, points: 5, gameStatus: ['W', 'W'] }, // won R1 + R2
    { sID: 16, points: 0, gameStatus: ['L'] }, // lost R1
    { sID: 12, points: 0, gameStatus: ['L'] }, // lost R1
    { sID: 14, points: 0, gameStatus: ['L'] }, // lost R1
  ];

  // Active/future games (R3 onwards, winner=null). Teams 1 and 5 seeded into game 13.
  const activeGames = [
    { gameID: 13, team1ID: 1, team2ID: 5, winner: null, nextGameID: 15 },
    { gameID: 14, team1ID: 3, team2ID: 7, winner: null, nextGameID: 15 },
    { gameID: 15, team1ID: null, team2ID: null, winner: null, nextGameID: 61 },
    { gameID: 61, team1ID: null, team2ID: null, winner: null, nextGameID: 63 },
    { gameID: 63, team1ID: null, team2ID: null, winner: null, nextGameID: 0 },
  ];

  describe('calculateEntryPointsAndPaths — possPoints', () => {
    it('correctly computes currentPoints and possPoints for 3 still-active picks', async () => {
      const picks = [1, 5, 3];
      const { currentPoints, maxPoints } = calculateEntryPointsAndPaths(
        picks,
        allTeams,
        activeGames,
      );

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
      const { currentPoints, maxPoints } = calculateEntryPointsAndPaths(
        picks,
        allTeams,
        activeGames,
      );
      expect(currentPoints).toBe(0);
      expect(maxPoints).toBe(0);
    });
  });

  describe('best rank (getHighestPlace) — realistic matchup', () => {
    it('ranks active-pick entry 1st and busted entry 2nd with exact place values', async () => {
      const picksA = [1, 5, 3]; // all alive after R2
      const picksB = [16, 12, 14]; // all eliminated in R1

      const { currentPoints: pointsA, futureGamePaths: pathsA } =
        calculateEntryPointsAndPaths(picksA, allTeams, activeGames);
      const { currentPoints: pointsB, futureGamePaths: pathsB } =
        calculateEntryPointsAndPaths(picksB, allTeams, activeGames);

      const entryA = {
        entryID: 1,
        name: 'Active Bracket',
        points: pointsA,
        picks: picksA,
        futureGames: pathsA,
      };
      const entryB = {
        entryID: 2,
        name: 'All Busted',
        points: pointsB,
        picks: picksB,
        futureGames: pathsB,
      };

      entryA.minPoints = minPoints(pathsA, pointsA);
      entryB.minPoints = minPoints(pathsB, pointsB);

      // Team 1 and team 5 are both heading to game 13 → guaranteed R3 clash points (5)
      // minPoints_A = 15 + 5 = 20; minPoints_B = 0
      expect(entryA.minPoints).toBe(20);
      expect(entryB.minPoints).toBe(0);

      const allEntries = [entryA, entryB];
      const { highestPlace: placeA, ties: tiesA } = getHighestPlace(
        entryA,
        allEntries,
      );
      const { highestPlace: placeB, ties: tiesB } = getHighestPlace(
        entryB,
        allEntries,
      );

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

      const entryX = {
        entryID: 10,
        name: 'Twin X',
        points: pts,
        picks,
        futureGames: paths,
      };
      const entryY = {
        entryID: 11,
        name: 'Twin Y',
        points: pts,
        picks,
        futureGames: paths,
      };

      entryX.minPoints = minPoints(paths, pts);
      entryY.minPoints = minPoints(paths, pts);

      const allEntries = [entryX, entryY];
      const { highestPlace: placeX, ties: tiesX } = getHighestPlace(
        entryX,
        allEntries,
      );
      const { highestPlace: placeY, ties: tiesY } = getHighestPlace(
        entryY,
        allEntries,
      );

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
  const gamesMap = new Map([
    [13, { gameID: 13, nextGameID: 15 }],
    [15, { gameID: 15, nextGameID: 61 }],
    [61, { gameID: 61, nextGameID: 63 }],
    [63, { gameID: 63, nextGameID: 0 }], // championship — terminal
  ]);

  it('terminates at championship (nextGameID = 0) and returns accumulated path', () => {
    // Starting at game 61 with path already containing prior IDs
    const result = getNextFutureGame(['W', 'W', 13, 15, 61], gamesMap, 61);
    // 61's nextGameID is 63, 63's nextGameID is 0 → stop. Path gets 63 appended.
    expect(result).toEqual(['W', 'W', 13, 15, 61, 63]);
  });

  // #304: a missing lookup entry must not discard the path collected so far.
  // Round-2+ slots aren't in `activeGames` until both teams are assigned, so
  // `nextGameID` legitimately points to an as-yet-absent game during early
  // rounds; the caller's `?? []` fallback used to wipe out the whole chain
  // (including the already-prepended `nextGameID`) whenever this returned
  // null, understating maxPoints for every entry holding that team.
  it('returns the accumulated path (not null) when the starting gameID is not found', () => {
    const result = getNextFutureGame(['W', 99], gamesMap, 99);
    expect(result).toEqual(['W', 99]);
  });

  it('returns the path collected up to a gap in the middle of the chain', () => {
    // 13 → 15 → (61 missing from lookup) → would-be 63
    const sparseMap = new Map([
      [13, { gameID: 13, nextGameID: 15 }],
      [15, { gameID: 15, nextGameID: 61 }],
    ]);
    const result = getNextFutureGame(['W', 'W', 13], sparseMap, 13);
    // Walk finds 13→15, collects 15's nextGameID (61) before discovering 61
    // itself isn't in the lookup — stop and return the path collected so far,
    // including the not-yet-resolved 61 slot.
    expect(result).toEqual(['W', 'W', 13, 15, 61]);
  });

  it('builds the full chain from an early game to the championship', () => {
    const result = getNextFutureGame(['W', 'W', 13], gamesMap, 13);
    expect(result).toEqual(['W', 'W', 13, 15, 61, 63]);
  });

  it('returns the path unchanged when given a single-game bracket (nextGameID = 0)', () => {
    const singleGameMap = new Map([[1, { gameID: 1, nextGameID: 0 }]]);
    const result = getNextFutureGame([1], singleGameMap, 1);
    expect(result).toEqual([1]);
  });

  // C4 regression: a corrupted nextGameID that points back to itself (or any
  // cycle) used to recurse forever and stack-overflow. It must now return the
  // accumulated path and log an error rather than hang.
  it('detects a self-referential nextGameID cycle and exits without infinite recursion', () => {
    const corruptedMap = new Map([[5, { gameID: 5, nextGameID: 5 }]]);
    const result = getNextFutureGame([], corruptedMap, 5);
    // The visited-set guard kicks in once we revisit 5 after appending it once.
    expect(result).toEqual([5]);
  });

  it('detects a multi-node cycle (A → B → A) without recursion', () => {
    const cyclicChainMap = new Map([
      [1, { gameID: 1, nextGameID: 2 }],
      [2, { gameID: 2, nextGameID: 1 }],
    ]);
    const result = getNextFutureGame([], cyclicChainMap, 1);
    // Walk: visit 1 (collect 2), visit 2 (collect 1), then 1 is already visited → break.
    expect(result).toEqual([2, 1]);
  });

  it('caps traversal at MAX_FUTURE_GAME_DEPTH (10) on a pathologically long chain', () => {
    // 15 games linked tail-to-head; final nextGameID intentionally non-zero so
    // only the depth cap can terminate traversal.
    const longChainMap = new Map();
    for (let i = 0; i < 15; i++) {
      longChainMap.set(i + 1, { gameID: i + 1, nextGameID: i + 2 });
    }
    const result = getNextFutureGame([], longChainMap, 1);
    // After MAX_FUTURE_GAME_DEPTH=10 iterations we should have collected exactly 10 nextUps.
    expect(result).toHaveLength(10);
  });
});

// ─── findNextGameId ───────────────────────────────────────────────────────────

describe('findNextGameId', () => {
  const activeGames = [
    { gameID: 5, team1ID: 1, team2ID: 2, winner: null },
    { gameID: 6, team1ID: 3, team2ID: 4, winner: null },
    { gameID: 9, team1ID: 5, team2ID: 6, winner: 5 }, // already decided
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

  it('supports O(1) lookups when passed a precomputed Map', () => {
    const map = new Map([
      [1, activeGames[0]],
      [2, activeGames[0]],
      [3, activeGames[1]],
      [4, activeGames[1]],
      [5, activeGames[2]],
      [6, activeGames[2]],
    ]);
    expect(findNextGameId(1, map)).toBe(5);
    expect(findNextGameId(4, map)).toBe(6);
    expect(findNextGameId(5, map)).toBe(-1); // already decided
    expect(findNextGameId(99, map)).toBe(-1);
  });

  it('reflects in-place array mutations on subsequent calls (no stale cache)', () => {
    const games = [{ gameID: 10, team1ID: 20, team2ID: 21, winner: null }];
    expect(findNextGameId(20, games)).toBe(10);

    // Mutate the game to simulate it finishing
    games[0].winner = 20;

    // Should immediately reflect the change and return -1
    expect(findNextGameId(20, games)).toBe(-1);
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
  const ffGame = {
    gameID: 64,
    round: 0,
    team1ID: 100,
    team2ID: 200,
    winner: null,
    nextGameID: 5,
    nextGameSpot: 1,
  };
  const r1Game = {
    gameID: 5,
    round: 1,
    team1ID: null,
    team2ID: 50,
    winner: null,
    nextGameID: 9,
  };
  const r2Game = {
    gameID: 9,
    round: 2,
    team1ID: null,
    team2ID: null,
    winner: null,
    nextGameID: 13,
  };
  const r3Game = {
    gameID: 13,
    round: 3,
    team1ID: null,
    team2ID: null,
    winner: null,
    nextGameID: 15,
  };
  const r4Game = {
    gameID: 15,
    round: 4,
    team1ID: null,
    team2ID: null,
    winner: null,
    nextGameID: 61,
  };
  const r5Game = {
    gameID: 61,
    round: 5,
    team1ID: null,
    team2ID: null,
    winner: null,
    nextGameID: 63,
  };
  const r6Game = {
    gameID: 63,
    round: 6,
    team1ID: null,
    team2ID: null,
    winner: null,
    nextGameID: 0,
  };

  const activeGames = [ffGame, r1Game, r2Game, r3Game, r4Game, r5Game, r6Game];

  // FF team before FF resolves: gameStatus=[], points=null
  const ffTeam1 = { sID: 100, points: null, gameStatus: [] };
  const ffTeam2 = { sID: 200, points: null, gameStatus: [] };
  // Regular R1 team in the same FF-fed slot
  const r1Team = { sID: 50, points: null, gameStatus: [] };

  const allTeams = [ffTeam1, ffTeam2, r1Team];

  it('FF team has 0 current points before FF resolves', () => {
    const { currentPoints } = calculateEntryPointsAndPaths(
      [100],
      allTeams,
      activeGames,
    );
    expect(currentPoints).toBe(0);
  });

  it('FF team possible points equal a normal R1 team (FF game adds no extra points)', () => {
    const { maxPoints: ffMax } = calculateEntryPointsAndPaths(
      [100],
      allTeams,
      activeGames,
    );
    const { maxPoints: r1Max } = calculateEntryPointsAndPaths(
      [50],
      allTeams,
      activeGames,
    );
    expect(ffMax).toBe(r1Max);
  });

  it('FF team future path starts at the R1 game (game 5), not the FF game (game 64)', () => {
    const { futureGamePaths } = calculateEntryPointsAndPaths(
      [100],
      allTeams,
      activeGames,
    );
    expect(futureGamePaths[0][0]).toBe(5); // first game in path is R1 game 5
    expect(futureGamePaths[0]).not.toContain(64); // FF game 64 must not appear in path
  });

  it('picking an FF team and the R1 opponent produces two independent non-clashing paths', () => {
    // User picks team 100 (FF) and team 50 (R1 opponent). Both should have full independent paths
    // because team 100's path starts at game 5 (same as team 50's), but removeDuplicateGames
    // should NOT cut team 50's path — they are the same game entry point but different sIDs.
    // Actually: both paths start at game 5, so removeDuplicateGames WILL see game 5 from both.
    // This is correct — they are opponents in game 5, only one can win.
    const { futureGamePaths, maxPoints } = calculateEntryPointsAndPaths(
      [100, 50],
      allTeams,
      activeGames,
    );
    // Both paths should start at game 5 (FF game excluded from both)
    expect(futureGamePaths[0][0]).toBe(5);
    expect(futureGamePaths[1][0]).toBe(5);
    // removeDuplicateGames will cut the second path at game 5 (already seen) — correct clash behavior
    // maxPoints should equal a single R1 team's max (not double, since they clash in game 5)
    const { maxPoints: singleMax } = calculateEntryPointsAndPaths(
      [100],
      allTeams,
      activeGames,
    );
    expect(maxPoints).toBe(singleMax);
  });

  it('FF game (round 0) is excluded from path even when it is the first active game', () => {
    // Regression: before the fix, the path for an FF team would include game 64, causing
    // calculateTeamFuturePoints to apply R1 points (2 pts) to the FF game — awarding
    // phantom points for a game that should score zero.
    const { futureGamePaths } = calculateEntryPointsAndPaths(
      [100],
      allTeams,
      activeGames,
    );
    expect(futureGamePaths[0]).not.toContain(64);
  });

  it('both FF slot teams have identical possible points (mirror of two regular R1 teams)', () => {
    const { maxPoints: max1 } = calculateEntryPointsAndPaths(
      [100],
      allTeams,
      activeGames,
    );
    const { maxPoints: max2 } = calculateEntryPointsAndPaths(
      [200],
      allTeams,
      activeGames,
    );
    expect(max1).toBe(max2);
  });

  it('regression: FF winner has correct possible points even when FF gameID is higher than R1 gameID', () => {
    // This replicates the real bracket where FF games (IDs 64+) would overwrite R1 games (IDs 1-32)
    // in the internal team-to-game map if built purely by gameID.
    const resolvedFF = {
      gameID: 64,
      round: 0,
      team1ID: 100,
      team2ID: 200,
      winner: 100,
      nextGameID: 5,
    };
    const unresolvedR1 = {
      gameID: 5,
      round: 1,
      team1ID: 100,
      team2ID: 50,
      winner: null,
      nextGameID: 0,
    };

    // Explicitly order them so gameID 64 is last
    const games = [unresolvedR1, resolvedFF];
    const teams = [{ sID: 100, points: 0, gameStatus: [] }];

    const { maxPoints } = calculateEntryPointsAndPaths([100], teams, games);
    // Should get points for the unresolved R1 game (2 points)
    expect(maxPoints).toBe(2);
  });
});

// ─── Max score boundary: First Four (round 0) vs Round 1 ────────────────────
//
// Validates the two scoring invariants around the FF/R1 boundary:
//   1. FF games are worth exactly 0 — win or lose, they never move max score.
//   2. Round 1 games affect max score only by converting potential points to
//      earned points: a pick winning its R1 game leaves the entry's max score
//      unchanged; losing collapses the pick's contribution to what was earned.
//
describe('max score boundary: First Four (round 0) vs Round 1', () => {
  const ffGame = {
    gameID: 64,
    round: 0,
    team1ID: 100,
    team2ID: 200,
    winner: null,
    nextGameID: 5,
    nextGameSpot: 1,
  };
  const r1Game = {
    gameID: 5,
    round: 1,
    team1ID: null,
    team2ID: 50,
    winner: null,
    nextGameID: 9,
  };
  const r2Game = {
    gameID: 9,
    round: 2,
    team1ID: null,
    team2ID: null,
    winner: null,
    nextGameID: 13,
  };
  const r3Game = {
    gameID: 13,
    round: 3,
    team1ID: null,
    team2ID: null,
    winner: null,
    nextGameID: 15,
  };
  const r4Game = {
    gameID: 15,
    round: 4,
    team1ID: null,
    team2ID: null,
    winner: null,
    nextGameID: 61,
  };
  const r5Game = {
    gameID: 61,
    round: 5,
    team1ID: null,
    team2ID: null,
    winner: null,
    nextGameID: 63,
  };
  const r6Game = {
    gameID: 63,
    round: 6,
    team1ID: null,
    team2ID: null,
    winner: null,
    nextGameID: 0,
  };
  const fullRunPoints = R(1) + R(2) + R(3) + R(4) + R(5) + R(6);

  it("a combined FF pick's max score is EXACTLY the R1→R6 sum — the FF game adds zero", () => {
    const games = [ffGame, r1Game, r2Game, r3Game, r4Game, r5Game, r6Game];
    const teams = [{ sID: 100, points: null, gameStatus: [] }];
    const { currentPoints, maxPoints } = calculateEntryPointsAndPaths(
      [100],
      teams,
      games,
    );
    expect(currentPoints).toBe(0);
    expect(maxPoints).toBe(fullRunPoints);
  });

  it('WINNING the FF game does not change max score (0 points for the win)', () => {
    // After resolution: winner 100 advanced into R1 game 5 slot 1, canonical
    // record still has points:null / gameStatus:[] (FF wins are never credited).
    const resolvedFF = { ...ffGame, winner: 100 };
    const filledR1 = { ...r1Game, team1ID: 100 };
    const games = [
      resolvedFF,
      filledR1,
      r2Game,
      r3Game,
      r4Game,
      r5Game,
      r6Game,
    ];
    const teams = [{ sID: 100, points: null, gameStatus: [] }];
    const { currentPoints, maxPoints } = calculateEntryPointsAndPaths(
      [100],
      teams,
      games,
    );
    expect(currentPoints).toBe(0); // win earned nothing
    expect(maxPoints).toBe(fullRunPoints); // and cost nothing
  });

  it('WINNING a Round 1 game does not change max score — R1 points move from potential to earned', () => {
    const before = (() => {
      const games = [
        { ...r1Game, team1ID: 60 },
        r2Game,
        r3Game,
        r4Game,
        r5Game,
        r6Game,
      ];
      const teams = [{ sID: 50, points: null, gameStatus: [] }];
      return calculateEntryPointsAndPaths([50], teams, games);
    })();
    const after = (() => {
      // Game 5 resolved in team 50's favor; team advanced into R2 game 9.
      const games = [
        { ...r1Game, team1ID: 60, winner: 50 },
        { ...r2Game, team2ID: 50 },
        r3Game,
        r4Game,
        r5Game,
        r6Game,
      ];
      const teams = [{ sID: 50, points: R(1), gameStatus: ['W'] }];
      return calculateEntryPointsAndPaths([50], teams, games);
    })();

    expect(before.currentPoints).toBe(0);
    expect(after.currentPoints).toBe(R(1));
    expect(after.maxPoints).toBe(before.maxPoints); // max score unmoved by the R1 result
  });

  it("LOSING a Round 1 game collapses the pick's max contribution to its earned points", () => {
    const games = [
      { ...r1Game, team1ID: 60, winner: 60 },
      r2Game,
      r3Game,
      r4Game,
      r5Game,
      r6Game,
    ];
    const teams = [{ sID: 50, points: 0, gameStatus: ['L'] }];
    const { currentPoints, maxPoints } = calculateEntryPointsAndPaths(
      [50],
      teams,
      games,
    );
    expect(currentPoints).toBe(0);
    expect(maxPoints).toBe(0); // eliminated: no future potential
  });
});

// ─── calculateEntryPointsAndPaths — edge cases ───────────────────────────────

describe('calculateEntryPointsAndPaths — edge cases', () => {
  it('skips a pick whose sID is not in allTeams and gives it an empty future path', () => {
    const picks = [1, 999]; // 999 doesn't exist
    const allTeams = [{ sID: 1, points: 2, gameStatus: ['W'] }];
    const activeGames = [
      { gameID: 9, team1ID: 1, team2ID: 2, winner: null, nextGameID: 0 },
    ];

    const { currentPoints, futureGamePaths } = calculateEntryPointsAndPaths(
      picks,
      allTeams,
      activeGames,
    );

    expect(currentPoints).toBe(2); // only team 1 contributes
    expect(futureGamePaths).toHaveLength(2); // one path per pick
    expect(futureGamePaths[1]).toEqual([]); // missing team → empty path
  });

  it('returns zero currentPoints and all-empty paths when every pick is missing', () => {
    const { currentPoints, maxPoints, futureGamePaths } =
      calculateEntryPointsAndPaths([88, 99], [], []);

    expect(currentPoints).toBe(0);
    expect(maxPoints).toBe(0);
    expect(futureGamePaths).toEqual([[], []]);
  });

  it('dedupes a duplicated pick so its points are not double-counted (#157)', () => {
    const allTeams = [{ sID: 1, points: 5, gameStatus: ['W', 'L'] }];
    const activeGames = [];

    const single = calculateEntryPointsAndPaths([1], allTeams, activeGames);
    const duped = calculateEntryPointsAndPaths([1, 1], allTeams, activeGames);

    // A duplicate must not inflate cumulative/max points or add a phantom path.
    expect(duped.currentPoints).toBe(single.currentPoints);
    expect(duped.maxPoints).toBe(single.maxPoints);
    expect(duped.futureGamePaths).toHaveLength(1);
  });

  it('eliminated team contributes its cumulative points but an empty future path', () => {
    const picks = [1];
    const allTeams = [{ sID: 1, points: 5, gameStatus: ['W', 'L'] }]; // eliminated in R2
    const activeGames = [];

    const { currentPoints, maxPoints, futureGamePaths } =
      calculateEntryPointsAndPaths(picks, allTeams, activeGames);

    expect(currentPoints).toBe(5);
    expect(maxPoints).toBe(5); // no future points
    expect(futureGamePaths[0]).toEqual([]);
  });
});

// ─── enrichEntriesWithPotentialRankings — duplicate-pick alignment (#157) ────
//
// getHighestPlace pairs entry.picks[i] with entry.futureGames[i] by index.
// calculateEntryPointsAndPaths returns futureGames deduped, so the enrichment
// must dedupe picks/pickSet identically or the coupling desyncs on a duplicated
// pick (undefined paths → NaN / crash). These guard that invariant.
describe('enrichEntriesWithPotentialRankings — duplicate-pick alignment (#157)', () => {
  const allTeams = [
    { sID: 1, points: 5, gameStatus: ['W', 'W'] },
    { sID: 3, points: 5, gameStatus: ['W', 'W'] },
  ];
  const activeGames = [
    { gameID: 13, team1ID: 1, team2ID: 9, winner: null, nextGameID: 15 },
    { gameID: 14, team1ID: 3, team2ID: 8, winner: null, nextGameID: 15 },
    { gameID: 15, team1ID: null, team2ID: null, winner: null, nextGameID: 0 },
  ];

  it('dedupes picks so picks/pickSet/futureGames stay index-aligned and points are not doubled', () => {
    const [dup, clean] = enrichEntriesWithPotentialRankings(
      [
        { id: 1, picks: [1, 1, 3], teamName: 'Dup', group: 'G' },
        { id: 2, picks: [1, 3], teamName: 'Clean', group: 'G' },
      ],
      allTeams,
      activeGames,
    );

    // Duplicate collapsed: arrays stay the same length (the coupling invariant).
    expect(dup.picks).toEqual([1, 3]);
    expect(dup.picks.length).toBe(dup.futureGames.length);
    expect(dup.pickSet.size).toBe(2);

    // Cumulative points not double-counted, and identical to the clean entry.
    expect(dup.points).toBe(10);
    expect(dup.points).toBe(clean.points);
    expect(dup.maxPoints).toBe(clean.maxPoints);

    // Ranking is finite (no NaN from undefined paths) and ties the clean twin.
    expect(Number.isFinite(dup.highestPlace)).toBe(true);
    expect(dup.highestPlace).toBe(clean.highestPlace);
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
      entryID: 1,
      name: 'A',
      points: 10,
      maxPoints: 15,
      minPoints: 10,
      picks: [1],
      futureGames: [['g1', 'W']],
    };
    const entryB = {
      entryID: 2,
      name: 'B',
      points: 20,
      maxPoints: 20,
      minPoints: 20,
      picks: [2],
      futureGames: [[]],
    };

    const { highestPlace, ties } = getHighestPlace(entryA, [entryA, entryB]);
    expect(highestPlace).toBe(2);
    expect(ties).toBe(0);
  });

  it('early exit: A.points > B.maxPoints → A definitely beats B', () => {
    // A has 50 current points (floor). B has maxPoints=30 (ceiling).
    // A's floor exceeds B's ceiling, so A wins in every scenario.
    const entryA = {
      entryID: 1,
      name: 'A',
      points: 50,
      maxPoints: 50,
      minPoints: 50,
      picks: [1],
      futureGames: [[]],
    };
    const entryB = {
      entryID: 2,
      name: 'B',
      points: 10,
      maxPoints: 30,
      minPoints: 10,
      picks: [2],
      futureGames: [['g1', 'g2', 'W']],
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
      entryID: 1,
      name: 'A',
      points: 10,
      maxPoints: 10 + r1Points + r2Points,
      minPoints: 10,
      picks: [1],
      futureGames: [['g1', 'g2', 'W']],
    };
    const entryB = {
      entryID: 2,
      name: 'B',
      points: 10 + r1Points,
      maxPoints: 10 + r1Points + r1Points + r2Points,
      minPoints: 10 + r1Points,
      picks: [2],
      futureGames: [['g3', 'g4', 'W']],
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
      entryID: 1,
      name: 'A',
      points: 10,
      minPoints: 10,
      picks: [1],
      futureGames: [['g1', 'W']],
    };
    const entryB = {
      entryID: 2,
      name: 'B',
      points: 500,
      minPoints: 500,
      picks: [2],
      futureGames: [[]],
    };

    const { highestPlace, ties } = getHighestPlace(entryA, [entryA, entryB]);
    expect(highestPlace).toBe(2);
    expect(ties).toBe(0);
  });

  it('results with maxPoints match results without maxPoints', () => {
    // Property test: adding maxPoints should not change the ranking outcome.
    const baseEntries = [
      {
        entryID: 1,
        name: 'A',
        points: 30,
        minPoints: 30,
        picks: [1, 2],
        futureGames: [
          ['g1', 'W'],
          ['g1', 'W'],
        ],
      },
      {
        entryID: 2,
        name: 'B',
        points: 20,
        minPoints: 20,
        picks: [3],
        futureGames: [['g2', 'g3', 'W']],
      },
      {
        entryID: 3,
        name: 'C',
        points: 50,
        minPoints: 50,
        picks: [4],
        futureGames: [[]],
      },
    ];

    // Without maxPoints
    const withoutMax = baseEntries.map((e) => {
      const { highestPlace, ties } = getHighestPlace(e, baseEntries);
      return { entryID: e.entryID, highestPlace, ties };
    });

    // With maxPoints added
    const entriesWithMax = baseEntries.map((e) => ({
      ...e,
      maxPoints: getFuturePoints(e.futureGames, e.points),
    }));
    const withMax = entriesWithMax.map((e) => {
      const { highestPlace, ties } = getHighestPlace(e, entriesWithMax);
      return { entryID: e.entryID, highestPlace, ties };
    });

    expect(withMax).toEqual(withoutMax);
  });

  it('early exit handles multi-entry group with mixed clear-cut and uncertain pairs', () => {
    // 4 entries: some pairs are clear-cut (early exit), others need full analysis.
    const entryA = {
      entryID: 1,
      name: 'Leader',
      points: 100,
      maxPoints: 100,
      minPoints: 100,
      picks: [1],
      futureGames: [[]],
    };
    const entryB = {
      entryID: 2,
      name: 'Contender',
      points: 80,
      maxPoints: 95,
      minPoints: 80,
      picks: [2],
      futureGames: [['g1', 'g2', 'W']],
    };
    const entryC = {
      entryID: 3,
      name: 'Longshot',
      points: 20,
      maxPoints: 50,
      minPoints: 20,
      picks: [3],
      futureGames: [['g3', 'g4', 'g5', 'W']],
    };
    const entryD = {
      entryID: 4,
      name: 'Busted',
      points: 5,
      maxPoints: 5,
      minPoints: 5,
      picks: [4],
      futureGames: [[]],
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
      entryID: 1,
      name: 'A',
      points: 20,
      maxPoints: 20 + futurePts,
      minPoints: 20,
      picks: [1],
      futureGames: [['g1', 'g2', 'g3', 'W']],
    };
    const entryB = {
      entryID: 2,
      name: 'B',
      points: 20 + futurePts,
      maxPoints: 20 + futurePts,
      minPoints: 20 + futurePts,
      picks: [2],
      futureGames: [[]],
    };

    // A.maxPoints (30) == B.points (30) → no early exit (not strictly less).
    // Full analysis: A's unique max = getFuturePoints([['g1','g2','g3','W']], 20) = 30.
    // B's unique min = minPoints([[]], 30) = 30. Equal → tie.
    const { highestPlace, ties } = getHighestPlace(entryA, [entryA, entryB]);
    expect(highestPlace).toBe(1);
    expect(ties).toBe(1);
  });
});

describe('getHighestPlace — bitmask memoization parity', () => {
  // When the cache is hit (multiple others produce the same overlap mask
  // against entry.picks), the result must match the value computed without
  // the cache. This guards against bitmask bugs (wrong index, off-by-one,
  // sign-bit overflow) that would silently corrupt the ranking.
  it('produces identical ranking whether the cache is hit or not', () => {
    const entryPicks = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
    const entryFutures = entryPicks.map((_, i) => [`e${i}a`, `e${i}b`, 'W']);
    const entry = {
      entryID: 1,
      name: 'Entry',
      points: 0,
      maxPoints: null,
      picks: entryPicks,
      futureGames: entryFutures,
      pickSet: new Set(entryPicks),
    };

    // Build 20 other entries. Half share picks [10,11] with entry (same mask),
    // the other half share [10,11,12] (different mask). For a given mask the
    // value of A's potentialFromUniquePicks must be identical, so cache reuse
    // must not change the final rank.
    const others = [];
    for (let k = 0; k < 20; k++) {
      const sharedTwo = k % 2 === 0;
      const sharedPicks = sharedTwo ? [10, 11] : [10, 11, 12];
      const ownPicks = [100 + k, 200 + k, 300 + k];
      const picks = [...sharedPicks, ...ownPicks];
      others.push({
        entryID: 100 + k,
        name: `O${k}`,
        points: 0,
        maxPoints: null,
        picks,
        futureGames: picks.map((_, i) => [`o${k}_${i}`, 'W']),
        pickSet: new Set(picks),
      });
    }

    const all = [entry, ...others];
    const withCache = getHighestPlace(entry, all);

    // Recompute one-other-at-a-time so each call sees a fresh, empty cache.
    let highestPlaceUncached = 1;
    let tiesUncached = 0;
    for (const o of others) {
      const sub = getHighestPlace(entry, [entry, o]);
      if (sub.highestPlace > 1) highestPlaceUncached++;
      tiesUncached += sub.ties;
    }

    expect(withCache.highestPlace).toBe(highestPlaceUncached);
    expect(withCache.ties).toBe(tiesUncached);
  });

  it('produces identical ranking when passing a shared otherMinCaches Map, and verifies caching occurred', () => {
    const entryPicks = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
    const entryFutures = entryPicks.map((_, i) => [`e${i}a`, `e${i}b`, 'W']);
    const entry1 = {
      entryID: 1,
      name: 'E1',
      points: 10,
      maxPoints: 50,
      picks: entryPicks,
      futureGames: entryFutures,
      pickSet: new Set(entryPicks),
    };

    const entry2 = {
      entryID: 2,
      name: 'E2',
      points: 12,
      maxPoints: 50,
      picks: entryPicks,
      futureGames: entryFutures,
      pickSet: new Set(entryPicks),
    };

    const others = [];
    for (let k = 0; k < 50; k++) {
      const sharedPicks = [10, 11, 12];
      const ownPicks = [100 + k, 200 + k];
      const picks = [...sharedPicks, ...ownPicks];
      others.push({
        entryID: 100 + k,
        name: `O${k}`,
        points: 8,
        maxPoints: 40,
        picks,
        futureGames: picks.map((_, i) => [`o${k}_${i}`, 'W']),
        pickSet: new Set(picks),
      });
    }

    const all = [entry1, entry2, ...others];

    const otherMinCaches = new Map();

    const res1Cached = getHighestPlace(entry1, all, otherMinCaches);
    const res2Cached = getHighestPlace(entry2, all, otherMinCaches);

    const res1Uncached = getHighestPlace(entry1, all);
    const res2Uncached = getHighestPlace(entry2, all);

    // Verify cache correctness
    expect(res1Cached.highestPlace).toBe(res1Uncached.highestPlace);
    expect(res1Cached.ties).toBe(res1Uncached.ties);
    expect(res2Cached.highestPlace).toBe(res2Uncached.highestPlace);
    expect(res2Cached.ties).toBe(res2Uncached.ties);

    // Verify that otherMinCaches was populated
    expect(otherMinCaches.size).toBeGreaterThan(0);
    // Each otherEntry's cache entry should map its unique picks bitmask to its relative floor points
    for (const o of others) {
      const cache = otherMinCaches.get(o.entryID);
      expect(cache).toBeDefined();
      expect(cache.size).toBeGreaterThan(0);
    }
  });

  // Stronger parity test. The previous test gave entry1 and entry2 identical
  // picksets and clash-free futureGames, which meant (a) the cache key's mask
  // dimension was never exercised, and (b) every cached value was equal to
  // otherEntry.points, so a buggy cache that ignored the mask would still
  // pass. This test fixes both: entry1 and entry2 have DIFFERENT picksets so
  // they produce different bitmasks against the same `other`, and each
  // `other` has a real clash among its own picks so minPoints returns a
  // non-trivial value that varies by which picks are masked in.
  it('cached otherRelativeMin values are correct for every (otherEntry, mask) the cache stores', () => {
    const r1 = TOURNAMENT_ROUNDS[1].roundPoints || 0;

    // entry1 and entry2 share only some picks — picking 10/11 is the overlap.
    // entry1 also shares pick 500 with other k=0 (one of its clashing picks),
    // so for that other, entry1's mask excludes a clashing-pair index → its
    // subset loses the clash → its cached value is r1 less than entry2's
    // value for the same `other`. Without this asymmetry, both entries'
    // bitmasks (though different) would yield the same minPoints result
    // and a wrong-mask cache bug could not be detected.
    const entry1 = {
      entryID: 1,
      name: 'E1',
      points: 10,
      maxPoints: 100,
      picks: [10, 11, 12, 13, 500],
      futureGames: [10, 11, 12, 13, 500].map((_, i) => [`e1_${i}`, 'W']),
      pickSet: new Set([10, 11, 12, 13, 500]),
    };
    const entry2 = {
      entryID: 2,
      name: 'E2',
      points: 12,
      maxPoints: 100,
      picks: [10, 11, 20, 21, 22],
      futureGames: [10, 11, 20, 21, 22].map((_, i) => [`e2_${i}`, 'W']),
      pickSet: new Set([10, 11, 20, 21, 22]),
    };

    // Each `other` has a clash among picks at indices 2 and 3: both paths
    // converge on gameId `clash_${k}` in round 1. minPoints credits r1
    // when both clashing picks are present in the masked subset, and zero
    // when either is masked out — so the cached value depends on the mask.
    const others = [];
    for (let k = 0; k < 12; k++) {
      // Pick layout chosen so entry1 and entry2 produce DIFFERENT bitmasks
      // against this other:
      //   - shared with entry1 only: 12   (index 0)
      //   - shared with entry2 only: 20   (index 1)
      //   - the clashing pair (own): 500+k (idx 2), 600+k (idx 3)
      //   - own non-clashing pick:   700+k (index 4)
      const picks = [12, 20, 500 + k, 600 + k, 700 + k];
      others.push({
        entryID: 1000 + k,
        name: `O${k}`,
        points: 5,
        maxPoints: 50,
        picks,
        futureGames: [
          [`o${k}_idx0`, 'W'],
          [`o${k}_idx1`, 'W'],
          [`clash_${k}`, 'W'], // clashes with idx 3
          [`clash_${k}`, 'W'], // clashes with idx 2
          [`o${k}_idx4`, 'W'],
        ],
        pickSet: new Set(picks),
      });
    }

    const all = [entry1, entry2, ...others];
    const otherMinCaches = new Map();

    const res1Cached = getHighestPlace(entry1, all, otherMinCaches);
    const res2Cached = getHighestPlace(entry2, all, otherMinCaches);
    const res1Uncached = getHighestPlace(entry1, all);
    const res2Uncached = getHighestPlace(entry2, all);

    // End-to-end parity.
    expect(res1Cached.highestPlace).toBe(res1Uncached.highestPlace);
    expect(res1Cached.ties).toBe(res1Uncached.ties);
    expect(res2Cached.highestPlace).toBe(res2Uncached.highestPlace);
    expect(res2Cached.ties).toBe(res2Uncached.ties);

    // The two entries produce DIFFERENT bitmasks against each other (entry1
    // shares pick 12; entry2 shares pick 20), so each other must have at
    // least two distinct mask entries in its cache. This is what the
    // previous test failed to exercise.
    for (const o of others) {
      const oCache = otherMinCaches.get(o.entryID);
      expect(oCache).toBeDefined();
      expect(oCache.size).toBeGreaterThanOrEqual(2);
    }

    // The strongest check: every cached (otherEntry, mask) -> value must
    // equal what minPoints returns when called fresh on the corresponding
    // subset of futureGames. An incorrect cache implementation that returned the wrong-mask
    // value would diverge here even though end-to-end parity holds (when
    // errors happen to cancel).
    for (const o of others) {
      const oCache = otherMinCaches.get(o.entryID);
      for (const [mask, cachedValue] of oCache) {
        const subsetPaths = [];
        for (let i = 0; i < o.picks.length; i++) {
          if (mask & (1 << i)) subsetPaths.push(o.futureGames[i]);
        }
        const fresh = minPoints(subsetPaths, o.points);
        expect(cachedValue).toBe(fresh);
      }
    }

    // Sanity: the clash mechanism is actually exercised. At least one
    // cached value must exceed otherEntry.points by r1 — otherwise the
    // futureGames setup is too trivial and we are back to the weak test.
    let sawClashCredit = false;
    for (const o of others) {
      for (const v of otherMinCaches.get(o.entryID).values()) {
        if (v >= o.points + r1) {
          sawClashCredit = true;
          break;
        }
      }
      if (sawClashCredit) break;
    }
    expect(sawClashCredit).toBe(true);

    // Discrimination check: for at least one `other`, the two stored mask
    // entries must hold DIFFERENT values. Without this, an incorrect cache implementation that
    // returned the wrong-mask value could still pass the per-(mask, value)
    // recomputation check, because the recomputed value on the wrong mask's
    // subset coincidentally equals the cached value. entry1 shares one of
    // other k=0's clashing picks (500), so for that other the two masks
    // produce different minPoints values.
    let sawMaskDiscrimination = false;
    for (const o of others) {
      const vals = [...otherMinCaches.get(o.entryID).values()];
      if (
        vals.length >= 2 &&
        vals.some((v, i) => vals.slice(i + 1).some((w) => v !== w))
      ) {
        sawMaskDiscrimination = true;
        break;
      }
    }
    expect(sawMaskDiscrimination).toBe(true);
  });
});
