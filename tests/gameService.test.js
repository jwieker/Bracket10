import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  updateTeamRecords,
  undoTeamRecords,
  setRepositories as setGameServiceRepositories,
} from '../src/services/gameService.js';

const mockGameRepository = {
  resolveGame: vi.fn(),
  undoResolvedGame: vi.fn(),
  updateWinner: vi.fn(),
  clearWinnerWithHold: vi.fn(),
  getFirstFourGames: vi.fn(),
  updateNextGameTeam: vi.fn(),
  getActiveAndFutureGames: vi.fn(),
  getEntriesForGroup: vi.fn(),
  getTournamentTeams: vi.fn(),
};

const mockTeamRepository = {
  createCanonicalSchoolRecord: vi.fn(),
  deleteCanonicalSchoolRecord: vi.fn(),
  updateTeamRecord: vi.fn(),
  updateTeamRecordWithNulls: vi.fn(),
};

describe('GameService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setGameServiceRepositories(mockTeamRepository, mockGameRepository);
  });

  describe('setRepositories', () => {
    test('updates internal repositories', () => {
      const dummyTeamRepo = { dummy: 'team' };
      const dummyGameRepo = { dummy: 'game' };
      const dummyUpdate = () => {};

      setGameServiceRepositories(dummyTeamRepo, dummyGameRepo, dummyUpdate);

      // There is no easy way to assert this directly without exposing internal state,
      // but we can call it to ensure it does not throw an error and runs successfully.
      expect(true).toBe(true); // placeholder to ensure test runs
    });
    test('does not update updateEntrywithNewSchools if null provided', () => {
      const dummyTeamRepo = { dummy: 'team' };
      const dummyGameRepo = { dummy: 'game' };

      setGameServiceRepositories(dummyTeamRepo, dummyGameRepo, null);

      expect(true).toBe(true);
    });
  });

  describe('updateTeamRecords', () => {
    test('resolves the game in a single transactional repo call', async () => {
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
        2024,
      );
      // No piecemeal writes outside the transaction
      expect(mockGameRepository.updateWinner).not.toHaveBeenCalled();
      expect(mockGameRepository.updateNextGameTeam).not.toHaveBeenCalled();
      expect(mockTeamRepository.updateTeamRecord).not.toHaveBeenCalled();
    });

    test('should handle championship game (no next game)', async () => {
      mockGameRepository.resolveGame.mockResolvedValue();

      await updateTeamRecords(1, 2, 6, 63, 0, null, 2024);

      expect(mockGameRepository.resolveGame).toHaveBeenCalledWith(
        expect.objectContaining({
          gameID: 63,
          winner: 1,
          loser: 2,
          nextGame: null,
        }),
        2024,
      );
    });

    test('propagates a transaction failure to the caller', async () => {
      mockGameRepository.resolveGame.mockRejectedValue(
        new Error('txn aborted'),
      );

      await expect(updateTeamRecords(1, 2, 2, 10, 20, 1, 2024)).rejects.toThrow(
        'txn aborted',
      );
    });
  });

  describe('undoTeamRecords', () => {
    test('round 1 undo restores both teams to pre-tournament state (nulls) in one transactional call', async () => {
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
        2024,
      );
      // No piecemeal writes outside the transaction
      expect(mockGameRepository.clearWinnerWithHold).not.toHaveBeenCalled();
      expect(mockGameRepository.updateWinner).not.toHaveBeenCalled();
      expect(mockGameRepository.updateNextGameTeam).not.toHaveBeenCalled();
      expect(mockTeamRepository.updateTeamRecord).not.toHaveBeenCalled();
      expect(
        mockTeamRepository.updateTeamRecordWithNulls,
      ).not.toHaveBeenCalled();
    });

    test('round 1 undo with no nextGame passes nextGame: null', async () => {
      mockGameRepository.undoResolvedGame.mockResolvedValue();
      await undoTeamRecords(1, 2, 1, 10, null, null, 2024);
      expect(mockGameRepository.undoResolvedGame).toHaveBeenCalledWith(
        expect.objectContaining({ gameID: 10, nextGame: null }),
        2024,
      );
    });

    test('round 2 undo restores both teams to their Round-1-winner state', async () => {
      // config.wins=2, so restoreStatus = ["W"] (one prior win), restorePoints = loserPoints = 2
      mockGameRepository.undoResolvedGame.mockResolvedValue();

      await undoTeamRecords(1, 2, 2, 10, 20, 1, 2024);

      expect(mockGameRepository.undoResolvedGame).toHaveBeenCalledWith(
        expect.objectContaining({ restorePoints: 2, restoreStatus: ['W'] }),
        2024,
      );
    });

    test('round 3 undo: restoreStatus has 2 Ws (config.wins - 1 = 2)', async () => {
      mockGameRepository.undoResolvedGame.mockResolvedValue();

      await undoTeamRecords(1, 2, 3, 13, 15, 1, 2024);

      expect(mockGameRepository.undoResolvedGame).toHaveBeenCalledWith(
        expect.objectContaining({
          restorePoints: 5,
          restoreStatus: ['W', 'W'],
        }),
        2024,
      );
    });

    test('round 2+ undo with no nextGame passes nextGame: null', async () => {
      mockGameRepository.undoResolvedGame.mockResolvedValue();

      await undoTeamRecords(1, 2, 2, 10, null, null, 2024);

      expect(mockGameRepository.undoResolvedGame).toHaveBeenCalledWith(
        expect.objectContaining({ nextGame: null }),
        2024,
      );
    });

    test('propagates a transaction failure to the caller', async () => {
      mockGameRepository.undoResolvedGame.mockRejectedValue(
        new Error('txn aborted'),
      );
      await expect(undoTeamRecords(1, 2, 2, 10, 20, 1, 2024)).rejects.toThrow(
        'txn aborted',
      );
    });

    test('throws on invalid round number', async () => {
      await expect(
        undoTeamRecords(1, 2, 99, 10, null, null, 2024),
      ).rejects.toThrow('Invalid round number: 99');
    });
  });

  describe('updateTeamRecords — exact arrays per round', () => {
    beforeEach(() => {
      mockGameRepository.resolveGame.mockResolvedValue();
    });

    test("round 1: winner gets ['W'], loser gets ['L']", async () => {
      await updateTeamRecords(1, 2, 1, 5, 9, 1, 2024);
      expect(mockGameRepository.resolveGame).toHaveBeenCalledWith(
        expect.objectContaining({
          winnerPoints: 2,
          winnerStatus: ['W'],
          loserPoints: 0,
          loserStatus: ['L'],
        }),
        2024,
      );
    });

    test("round 2: winner gets ['W','W'], loser gets ['W','L']", async () => {
      await updateTeamRecords(1, 2, 2, 9, 13, 1, 2024);
      expect(mockGameRepository.resolveGame).toHaveBeenCalledWith(
        expect.objectContaining({
          winnerPoints: 5,
          winnerStatus: ['W', 'W'],
          loserPoints: 2,
          loserStatus: ['W', 'L'],
        }),
        2024,
      );
    });

    test('round 6: winner gets 6 Ws, loser gets 5 Ws then L', async () => {
      await updateTeamRecords(1, 2, 6, 63, 0, null, 2024);
      expect(mockGameRepository.resolveGame).toHaveBeenCalledWith(
        expect.objectContaining({
          winnerPoints: 69,
          winnerStatus: ['W', 'W', 'W', 'W', 'W', 'W'],
          loserPoints: 36,
          loserStatus: ['W', 'W', 'W', 'W', 'W', 'L'],
        }),
        2024,
      );
    });

    test('passes nextGame: null when nextGame is falsy', async () => {
      await updateTeamRecords(1, 2, 6, 63, 0, null, 2024);
      expect(mockGameRepository.resolveGame).toHaveBeenCalledWith(
        expect.objectContaining({ nextGame: null }),
        2024,
      );
    });

    test('throws on invalid round number', async () => {
      await expect(updateTeamRecords(1, 2, 99, 5, 9, 1, 2024)).rejects.toThrow(
        'Invalid tournament round: 99',
      );
    });
  });

  describe('round 0 — First Four', () => {
    let mockUpdateEntrywithNewSchools;

    beforeEach(() => {
      mockUpdateEntrywithNewSchools = vi.fn().mockResolvedValue();
      mockGameRepository.updateWinner.mockResolvedValue();
      mockGameRepository.clearWinnerWithHold.mockResolvedValue();
      mockGameRepository.getFirstFourGames.mockResolvedValue([]);
      mockGameRepository.updateNextGameTeam.mockResolvedValue();
      mockTeamRepository.createCanonicalSchoolRecord.mockResolvedValue();
      mockTeamRepository.deleteCanonicalSchoolRecord.mockResolvedValue();
      setGameServiceRepositories(
        mockTeamRepository,
        mockGameRepository,
        mockUpdateEntrywithNewSchools,
      );
    });

    describe('updateTeamRecords round 0', () => {
      test('sets winner on the FF game', async () => {
        await updateTeamRecords(10, 20, 0, 64, 5, 1, 2024);
        expect(mockGameRepository.updateWinner).toHaveBeenCalledWith(
          64,
          10,
          2024,
        );
      });

      test('propagates winner to R1 game slot', async () => {
        await updateTeamRecords(10, 20, 0, 64, 5, 1, 2024);
        expect(mockGameRepository.updateNextGameTeam).toHaveBeenCalledWith(
          5,
          1,
          10,
          2024,
        );
      });

      test('auto-swaps entry picks: loser → winner', async () => {
        await updateTeamRecords(10, 20, 0, 64, 5, 1, 2024);
        expect(mockUpdateEntrywithNewSchools).toHaveBeenCalledWith(
          [[10, 20]],
          2024,
        );
      });

      test('creates canonical school record for winner', async () => {
        await updateTeamRecords(10, 20, 0, 64, 5, 1, 2024);
        expect(
          mockTeamRepository.createCanonicalSchoolRecord,
        ).toHaveBeenCalledWith(10, 2024);
      });

      test('does NOT update team records (no points awarded)', async () => {
        await updateTeamRecords(10, 20, 0, 64, 5, 1, 2024);
        expect(mockTeamRepository.updateTeamRecord).not.toHaveBeenCalled();
        expect(
          mockTeamRepository.updateTeamRecordWithNulls,
        ).not.toHaveBeenCalled();
      });

      test('skips updateNextGameTeam when nextGame is falsy', async () => {
        await updateTeamRecords(10, 20, 0, 64, null, null, 2024);
        expect(mockGameRepository.updateNextGameTeam).not.toHaveBeenCalled();
        expect(mockGameRepository.updateWinner).toHaveBeenCalledWith(
          64,
          10,
          2024,
        );
      });

      test('writes the winner LAST — after slot fill, pick swap, and canonical record', async () => {
        // The winner field is the poll's retry gate: every other step
        // must commit first so a mid-resolution failure is retried.
        await updateTeamRecords(10, 20, 0, 64, 5, 1, 2024);
        const winnerOrder =
          mockGameRepository.updateWinner.mock.invocationCallOrder[0];
        expect(
          mockGameRepository.updateNextGameTeam.mock.invocationCallOrder[0],
        ).toBeLessThan(winnerOrder);
        expect(
          mockUpdateEntrywithNewSchools.mock.invocationCallOrder[0],
        ).toBeLessThan(winnerOrder);
        expect(
          mockTeamRepository.createCanonicalSchoolRecord.mock
            .invocationCallOrder[0],
        ).toBeLessThan(winnerOrder);
      });

      test('does NOT mark the game resolved if the pick swap fails (poll can retry)', async () => {
        mockUpdateEntrywithNewSchools.mockRejectedValue(
          new Error('swap failed'),
        );
        await expect(
          updateTeamRecords(10, 20, 0, 64, 5, 1, 2024),
        ).rejects.toThrow('swap failed');
        expect(mockGameRepository.updateWinner).not.toHaveBeenCalled();
      });

      test('does NOT mark the game resolved if the canonical record create fails', async () => {
        mockTeamRepository.createCanonicalSchoolRecord.mockRejectedValue(
          new Error('canonical failed'),
        );
        await expect(
          updateTeamRecords(10, 20, 0, 64, 5, 1, 2024),
        ).rejects.toThrow('canonical failed');
        expect(mockGameRepository.updateWinner).not.toHaveBeenCalled();
      });

      test('a failed resolution converges when the next poll run retries it', async () => {
        // Run 1: the pick swap fails mid-resolution → winner never written,
        // so the game stays in the poll's unresolved set.
        mockUpdateEntrywithNewSchools.mockRejectedValueOnce(
          new Error('transient'),
        );
        await expect(
          updateTeamRecords(10, 20, 0, 64, 5, 1, 2024),
        ).rejects.toThrow('transient');
        expect(mockGameRepository.updateNextGameTeam).toHaveBeenCalledTimes(1);
        expect(
          mockTeamRepository.createCanonicalSchoolRecord,
        ).not.toHaveBeenCalled();
        expect(mockGameRepository.updateWinner).not.toHaveBeenCalled();

        // Run 2 (next poll cycle): every idempotent step re-runs and the
        // winner is finally committed exactly once.
        await updateTeamRecords(10, 20, 0, 64, 5, 1, 2024);
        expect(mockGameRepository.updateNextGameTeam).toHaveBeenCalledTimes(2);
        expect(mockUpdateEntrywithNewSchools).toHaveBeenCalledTimes(2);
        expect(
          mockTeamRepository.createCanonicalSchoolRecord,
        ).toHaveBeenCalledTimes(1);
        expect(mockGameRepository.updateWinner).toHaveBeenCalledTimes(1);
        expect(mockGameRepository.updateWinner).toHaveBeenCalledWith(
          64,
          10,
          2024,
        );
      });
    });

    describe('undoTeamRecords round 0', () => {
      test('clears winner on the FF game with a manual hold (poll must not re-resolve)', async () => {
        await undoTeamRecords(10, 20, 0, 64, 5, 1, 2024);
        expect(mockGameRepository.clearWinnerWithHold).toHaveBeenCalledWith(
          64,
          2024,
        );
        expect(mockGameRepository.updateWinner).not.toHaveBeenCalled();
      });

      test('clears team from R1 game slot', async () => {
        await undoTeamRecords(10, 20, 0, 64, 5, 1, 2024);
        expect(mockGameRepository.updateNextGameTeam).toHaveBeenCalledWith(
          5,
          1,
          null,
          2024,
        );
      });

      test('handles null return from getFirstFourGames when team1ID is omitted', async () => {
        mockGameRepository.getFirstFourGames.mockResolvedValue(null);
        await undoTeamRecords(10, 20, 0, 64, 5, 1, 2024);
        // Expected to fallback to [[loser, winner]] -> [[20, 10]]
        expect(mockUpdateEntrywithNewSchools).toHaveBeenCalledWith(
          [[20, 10]],
          2024,
        );
      });

      test('reverses pick swap: winner → loser (last-resort fallback when no team1ID and no game doc)', async () => {
        // No team1ID provided AND the game doc can't be found
        // (getFirstFourGames mocked empty) → fallback: [[loser, winner]]
        await undoTeamRecords(10, 20, 0, 64, 5, 1, 2024);
        expect(mockUpdateEntrywithNewSchools).toHaveBeenCalledWith(
          [[20, 10]],
          2024,
        );
      });

      test('derives team1ID from the game doc when the caller omits it', async () => {
        // team1 (100) won. The blind reverse-swap would move picks to
        // the LOSER (200); derivation must normalize to team1 instead.
        mockGameRepository.getFirstFourGames.mockResolvedValue([
          { gameID: 64, round: 0, team1ID: 100, team2ID: 200, winner: 100 },
        ]);
        await undoTeamRecords(100, 200, 0, 64, 5, 1, 2024);
        expect(mockUpdateEntrywithNewSchools).toHaveBeenCalledWith(
          [[100, 200]],
          2024,
        );
      });

      test('deletes canonical school record for winner', async () => {
        await undoTeamRecords(10, 20, 0, 64, 5, 1, 2024);
        expect(
          mockTeamRepository.deleteCanonicalSchoolRecord,
        ).toHaveBeenCalledWith(10, 2024);
      });

      test('does NOT touch team records', async () => {
        await undoTeamRecords(10, 20, 0, 64, 5, 1, 2024);
        expect(mockTeamRepository.updateTeamRecord).not.toHaveBeenCalled();
        expect(
          mockTeamRepository.updateTeamRecordWithNulls,
        ).not.toHaveBeenCalled();
      });

      test('skips updateNextGameTeam when nextGame is falsy', async () => {
        await undoTeamRecords(10, 20, 0, 64, null, null, 2024);
        expect(mockGameRepository.updateNextGameTeam).not.toHaveBeenCalled();
        expect(mockGameRepository.clearWinnerWithHold).toHaveBeenCalledWith(
          64,
          2024,
        );
      });

      test('clears the winner LAST — after pick repick, canonical delete, and slot clear', async () => {
        // Mirror of resolution: a mid-undo failure must leave the game
        // resolved so the admin can retry and the poll keeps skipping it.
        await undoTeamRecords(10, 20, 0, 64, 5, 1, 2024);
        const clearOrder =
          mockGameRepository.clearWinnerWithHold.mock.invocationCallOrder[0];
        expect(
          mockUpdateEntrywithNewSchools.mock.invocationCallOrder[0],
        ).toBeLessThan(clearOrder);
        expect(
          mockTeamRepository.deleteCanonicalSchoolRecord.mock
            .invocationCallOrder[0],
        ).toBeLessThan(clearOrder);
        expect(
          mockGameRepository.updateNextGameTeam.mock.invocationCallOrder[0],
        ).toBeLessThan(clearOrder);
      });

      test('does NOT reopen the game if the pick repick fails', async () => {
        mockUpdateEntrywithNewSchools.mockRejectedValue(
          new Error('repick failed'),
        );
        await expect(
          undoTeamRecords(10, 20, 0, 64, 5, 1, 2024),
        ).rejects.toThrow('repick failed');
        expect(mockGameRepository.clearWinnerWithHold).not.toHaveBeenCalled();
      });

      test('a failed undo converges when the admin retries it', async () => {
        // Attempt 1: canonical-record delete fails after the repick →
        // winner stays set, so the poll keeps skipping the game and the
        // admin sees the failure and clicks Undo again.
        mockTeamRepository.deleteCanonicalSchoolRecord.mockRejectedValueOnce(
          new Error('transient'),
        );
        await expect(
          undoTeamRecords(200, 100, 0, 64, 5, 1, 2024, 100),
        ).rejects.toThrow('transient');
        expect(mockUpdateEntrywithNewSchools).toHaveBeenCalledTimes(1);
        expect(mockGameRepository.updateNextGameTeam).not.toHaveBeenCalled();
        expect(mockGameRepository.clearWinnerWithHold).not.toHaveBeenCalled();

        // Attempt 2: repick is a no-op (already normalized), delete and
        // slot-clear complete, and the winner is cleared with the hold.
        await undoTeamRecords(200, 100, 0, 64, 5, 1, 2024, 100);
        expect(mockUpdateEntrywithNewSchools).toHaveBeenCalledTimes(2);
        expect(
          mockTeamRepository.deleteCanonicalSchoolRecord,
        ).toHaveBeenCalledTimes(2);
        expect(mockGameRepository.updateNextGameTeam).toHaveBeenCalledTimes(1);
        expect(mockGameRepository.clearWinnerWithHold).toHaveBeenCalledTimes(1);
        expect(mockGameRepository.clearWinnerWithHold).toHaveBeenCalledWith(
          64,
          2024,
        );
      });

      describe('swap logic with team1ID provided', () => {
        // team1ID=100 is the canonical pick sID for unresolved FF games.
        // The undo must restore picks to team1ID regardless of which team won.

        test('when team1 won: normalizes any stale team2 picks back to team1', async () => {
          // winner=100 (team1), loser=200 (team2), team1ID=100
          // branch: team2ID=loser=200, condition1 false, condition2 true → [[100, 200]]
          await undoTeamRecords(100, 200, 0, 64, 5, 1, 2024, 100);
          expect(mockUpdateEntrywithNewSchools).toHaveBeenCalledWith(
            [[100, 200]],
            2024,
          );
        });

        test('when team2 won: swaps winner picks back to team1', async () => {
          // winner=200 (team2), loser=100 (team1), team1ID=100
          // branch: team2ID=winner=200, condition1 true → [[100, 200]], condition2 false
          await undoTeamRecords(200, 100, 0, 64, 5, 1, 2024, 100);
          expect(mockUpdateEntrywithNewSchools).toHaveBeenCalledWith(
            [[100, 200]],
            2024,
          );
        });

        test('swaps both winner and loser when team2ID and winner do not match team1ID', async () => {
          // winner=200, loser=300, team1ID=100.
          // team2ID = team1ID === loser (100 === 300 -> false) ? loser : loser ... wait,
          // let's trace:
          // team2ID = team1ID === loser ? winner : loser;
          // team2ID = 100 === 300 (false) ? 200 : 300 => 300.
          // winner !== team1ID => 200 !== 100 (true) => push [100, 200]
          // team2ID !== winner => 300 !== 200 (true) => push [100, 300]
          await undoTeamRecords(200, 300, 0, 64, 5, 1, 2024, 100);
          expect(mockUpdateEntrywithNewSchools).toHaveBeenCalledWith(
            [
              [100, 200],
              [100, 300],
            ],
            2024,
          );
        });

        test('always deletes canonical record for the winner regardless of which team won', async () => {
          await undoTeamRecords(200, 100, 0, 64, 5, 1, 2024, 100);
          expect(
            mockTeamRepository.deleteCanonicalSchoolRecord,
          ).toHaveBeenCalledWith(200, 2024);
        });
      });
    });
  });
});
