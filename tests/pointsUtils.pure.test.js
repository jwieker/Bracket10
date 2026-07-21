import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getFuturePoints,
  minPoints,
  getHighestPlace,
} from '../src/utils/pointsUtils.js';
import Logger from '../src/utils/logger.js';

describe('pointsUtils', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('getFuturePoints', () => {
    it('returns currentPoints when futureGames is empty', () => {
      expect(getFuturePoints([], 10)).toBe(10);
    });

    it('calculates points from distinct paths without double counting', () => {
      const paths = [
        ['game1', 'game2', 'W'],
        ['game3', 'game4', 'W'],
        ['game1', 'game5', 'W'],
      ];
      expect(getFuturePoints(paths, 5)).toBe(15);
    });

    it('handles errors and logs them', () => {
      vi.spyOn(Logger, 'error').mockImplementation(() => {});
      expect(() => getFuturePoints(null, 10)).toThrow();
      expect(Logger.error).toHaveBeenCalledWith(
        'getFuturePoints failed',
        expect.objectContaining({
          currentPoints: 10,
          futureGamesLength: null,
        }),
      );
    });
  });

  describe('minPoints', () => {
    it('returns guaranteed points without sortedGames/incomingGames', () => {
      const paths = [['game1', 'game2'], ['game1', 'game3'], ['game4']];
      expect(minPoints(paths, 10)).toBe(12);
    });

    it('returns guaranteed points with sortedGames/incomingGames and handles >2 picks on a game', () => {
      const pathsClash = [
        ['gameA', 'gameC'],
        ['gameA', 'gameD'],
      ];
      const sortedGamesClash = [
        { round: 0, gameID: 'skippedRound' },
        { round: 1, gameID: 'gameA' },
      ];
      const incomingGamesClash = new Map([
        ['gameA', ['someGame1', 'someGame2']],
      ]);
      expect(
        minPoints(pathsClash, 10, sortedGamesClash, incomingGamesClash),
      ).toBe(12);
    });

    it('covers missing else branch for guaranteedPicks.set(g.gameID, 0)', () => {
      const paths = [['gameA', 'gameB']];
      const sortedGames = [
        { round: 1, gameID: 'gameA' },
        { round: 2, gameID: 'gameB' },
      ];
      const incomingGames = new Map();
      expect(minPoints(paths, 10, sortedGames, incomingGames)).toBe(10);
    });
  });

  describe('getHighestPlace', () => {
    it('works for basic cases', () => {
      const entry = {
        entryID: '1',
        picks: ['A', 'B'],
        points: 10,
        maxPoints: 20,
        futureGames: [
          ['game1'], // A
          ['game2'], // B
        ],
      };
      const allBobEntries = [
        entry, // skips itself
        {
          entryID: '2',
          picks: ['B', 'C'],
          points: 12,
          maxPoints: 15,
          futureGames: [
            ['game2'], // B
            ['game3'], // C
          ],
        },
        {
          entryID: '3',
          picks: ['D', 'E'],
          points: 5,
          maxPoints: 8,
          futureGames: [],
        },
        {
          entryID: '4',
          picks: ['A', 'B'],
          points: 30,
          maxPoints: 40,
          futureGames: [],
        },
        {
          entryID: '5',
          picks: ['E'],
          points: 100, // potentialFromUniquePicks < otherRelativeMin
          maxPoints: 200,
          futureGames: [['game2']],
        },
      ];

      const res = getHighestPlace(entry, allBobEntries);
      expect(res.highestPlace).toBe(3); // 4 and 5 beat it
      expect(res.ties).toBe(1); // 2 ties
    });

    it('covers highestPlace++ branch when potentialFromUniquePicks < otherRelativeMin - EPSILON', () => {
      const entry = {
        entryID: '1',
        picks: ['A'],
        points: 10,
        maxPoints: 20,
        futureGames: [['game1']],
      };
      const otherEntry = {
        entryID: '2',
        picks: ['B'],
        points: 15,
        maxPoints: 20,
        futureGames: [['game2']],
      };

      const res = getHighestPlace(entry, [entry, otherEntry]);
      expect(res.highestPlace).toBe(2);
      expect(res.ties).toBe(0);
    });

    it('utilizes caches and handles ties with POINTS_EPSILON', () => {
      const entry = {
        entryID: '1',
        picks: ['A'],
        points: 10,
        maxPoints: 20,
        futureGames: [['game1']],
      };
      const otherEntry = {
        entryID: '2',
        picks: ['B'],
        points: 12,
        maxPoints: 20,
        futureGames: [['game2']],
      };

      const otherMinCaches = new Map();

      // Run once to populate caches
      const res1 = getHighestPlace(entry, [entry, otherEntry], otherMinCaches);
      expect(res1.highestPlace).toBe(1);
      expect(res1.ties).toBe(1);

      // Run again to hit caches
      const res2 = getHighestPlace(entry, [entry, otherEntry], otherMinCaches);
      expect(res2.highestPlace).toBe(1);
      expect(res2.ties).toBe(1);

      expect(otherMinCaches.has('2')).toBe(true);
      expect(otherMinCaches.get('2').size).toBe(1);
    });
  });
});
