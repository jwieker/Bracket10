import {
  cacheGet,
  cacheSet,
  cacheDel,
  clearAllCache,
  invalidateCache,
  cacheDebugMiddleware,
} from '../src/utils/cacheUtils.js';

beforeEach(() => {
  clearAllCache();
});

describe('cacheGet / cacheSet / cacheDel', () => {
  test('returns undefined on cache miss', () => {
    expect(cacheGet('missing')).toBeUndefined();
  });

  test('returns value after set', () => {
    cacheSet('key1', { data: 42 });
    expect(cacheGet('key1')).toEqual({ data: 42 });
  });

  test('returns undefined after delete', () => {
    cacheSet('key2', 'hello');
    cacheDel('key2');
    expect(cacheGet('key2')).toBeUndefined();
  });
});

describe('clearAllCache', () => {
  test('flushes all keys', () => {
    cacheSet('a', 1);
    cacheSet('b', 2);
    clearAllCache();
    expect(cacheGet('a')).toBeUndefined();
    expect(cacheGet('b')).toBeUndefined();
  });
});

describe('invalidateCache', () => {
  test('deletes keys matching pattern', () => {
    cacheSet('games_2024_query', 1);
    cacheSet('games_2024_other', 2);
    cacheSet('entries_2024', 3);
    invalidateCache('games_2024');
    expect(cacheGet('games_2024_query')).toBeUndefined();
    expect(cacheGet('games_2024_other')).toBeUndefined();
  });

  test('leaves non-matching keys intact', () => {
    cacheSet('entries_2024', 99);
    cacheSet('games_2024', 1);
    invalidateCache('games_2024');
    expect(cacheGet('entries_2024')).toBe(99);
  });
});

// #353 — repository tests assert that mocked invalidateCache was called with
// literal prefixes like "gameViewData_2024_", but none of them prove that
// prefix actually matches the real key shape buildGameViewData caches under.
// If the key format drifts (e.g. a delimiter change in viewService), every
// mocked assertion keeps passing while invalidation silently stops matching —
// the stale-grid class of bug (#303). These tests run against the REAL cache
// with the current literal key shape; the drift guard against the REAL
// buildGameViewData write lives in services.test.js ("gameViewData cache key
// contract"), which captures the key the service actually caches under.
describe('invalidateCache × gameViewData key shape', () => {
  test('the year-scoped prefix used by entry mutations deletes a seeded gameViewData entry', () => {
    cacheSet('gameViewData_2024_SomeGroup', { standings: [1, 2, 3] });

    invalidateCache('gameViewData_2024_');

    expect(cacheGet('gameViewData_2024_SomeGroup')).toBeUndefined();
  });

  test("a different year's prefix leaves the entry intact", () => {
    cacheSet('gameViewData_2024_SomeGroup', { standings: [1, 2, 3] });

    invalidateCache('gameViewData_2025_');

    expect(cacheGet('gameViewData_2024_SomeGroup')).toEqual({
      standings: [1, 2, 3],
    });
  });
});

describe('cacheDebugMiddleware', () => {
  test('skips cache headers for non-admin requests', () => {
    cacheSet('debug_key', 'value');
    const req = {};
    const res = { setHeader: vi.fn() };
    const next = vi.fn();

    cacheDebugMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  test('sets cache headers for admin in non-production', () => {
    cacheSet('debug_key', 'value');
    const req = { session: { siteAdmin: true } };
    const headers = {};
    const res = {
      setHeader: vi.fn((k, v) => {
        headers[k] = v;
      }),
    };
    const next = vi.fn();

    cacheDebugMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Cache-Active-Keys',
      expect.any(String),
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Cache-Hits',
      expect.any(Number),
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Cache-Misses',
      expect.any(Number),
    );
  });
});
