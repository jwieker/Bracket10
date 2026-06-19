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
    const res = { setHeader: vi.fn((k, v) => { headers[k] = v; }) };
    const next = vi.fn();

    cacheDebugMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('X-Cache-Active-Keys', expect.any(String));
    expect(res.setHeader).toHaveBeenCalledWith('X-Cache-Hits', expect.any(Number));
    expect(res.setHeader).toHaveBeenCalledWith('X-Cache-Misses', expect.any(Number));
  });
});
