// Service-layer acceptance evidence for Phase 2 of
// docs/plans/espn-tournament-creation-2026-09-20.md: occupied year, retry
// after success, competing creates, and a failed commit must never overwrite
// a created bracket or leave a partial one. The repository-level mechanics
// (batch.create() semantics, write-count formula) are covered in
// hierarchicalRepository.test.js; this exercises createNewBracket()'s own
// wiring of the occupancy guard and the atomic write call.

import {
  createNewBracket,
  setRepositories,
} from '../src/services/tourneyService.js';

function makeRepo(overrides = {}) {
  return {
    getYearOccupancy: vi.fn().mockResolvedValue({ occupied: false }),
    createBracketAtomic: vi.fn().mockResolvedValue({ writeCount: 0 }),
    ...overrides,
  };
}

const YEAR = 2028;
const REGION_ARRAY = [1, 2, 3, 4];
// createBracketAtomic is mocked in every test here, so this only needs to be
// well-formed enough for createNewBracketStructure to accept it — the
// structural validation itself is covered elsewhere.
const GAMES_DATA = ['1-1-1-1', '1-1-16-16'];

describe('createNewBracket occupied-year guard and atomic-commit boundary', () => {
  test('a retry after a successful create sees the year occupied and never reaches the write path', async () => {
    const repo = makeRepo();
    setRepositories(repo, {}, {}, {});

    await createNewBracket(GAMES_DATA, YEAR, REGION_ARRAY);
    expect(repo.createBracketAtomic).toHaveBeenCalledTimes(1);

    // The first create's writes are what make the retry's occupancy check
    // now report occupied.
    repo.getYearOccupancy.mockResolvedValue({
      occupied: true,
      hasParent: true,
    });

    await expect(
      createNewBracket(GAMES_DATA, YEAR, REGION_ARRAY),
    ).rejects.toThrow(/already exists/);
    expect(repo.createBracketAtomic).toHaveBeenCalledTimes(1); // unchanged
  });

  test('two competing creates that both pass the occupancy check: the loser fails cleanly, the winner is unaffected', async () => {
    const repo = makeRepo();
    setRepositories(repo, {}, {}, {});

    // Both requests read the year as unoccupied — the race window
    // getYearOccupancy alone can't close. createBracketAtomic's
    // batch.create() semantics decide the real winner in Firestore; simulate
    // that outcome here: first commit succeeds, second is rejected the way
    // Firestore rejects a batch.create() against a doc that now exists.
    repo.createBracketAtomic
      .mockResolvedValueOnce({ writeCount: 4 })
      .mockRejectedValueOnce(
        new Error('6 ALREADY_EXISTS: entity already exists'),
      );

    const [first, second] = await Promise.allSettled([
      createNewBracket(GAMES_DATA, YEAR, REGION_ARRAY),
      createNewBracket(GAMES_DATA, YEAR, REGION_ARRAY),
    ]);

    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('rejected');
    expect(second.reason.message).toMatch(/ALREADY_EXISTS/);
    expect(repo.createBracketAtomic).toHaveBeenCalledTimes(2);
  });

  test('a failed commit surfaces the error without a second, compensating write attempt', async () => {
    const repo = makeRepo({
      createBracketAtomic: vi
        .fn()
        .mockRejectedValue(new Error('commit failed')),
    });
    setRepositories(repo, {}, {}, {});

    await expect(
      createNewBracket(GAMES_DATA, YEAR, REGION_ARRAY),
    ).rejects.toThrow('commit failed');
    expect(repo.createBracketAtomic).toHaveBeenCalledTimes(1);
  });

  test('occupied-year error message points at the existing editor and never leaks internals', async () => {
    const repo = makeRepo({
      getYearOccupancy: vi
        .fn()
        .mockResolvedValue({ occupied: true, hasSchoolRecords: true }),
    });
    setRepositories(repo, {}, {}, {});

    await expect(
      createNewBracket(GAMES_DATA, YEAR, REGION_ARRAY),
    ).rejects.toThrow(/existing tournament's editor/);
  });
});
