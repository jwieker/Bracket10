import {
  cacheGet,
  cacheSet,
  cacheDel,
  clearAllCache,
  invalidateCache,
  cacheMiddleware,
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

describe('cacheMiddleware', () => {
  function makeMockRes() {
    const res = {
      _stored: null,
      json: vi.fn(function(body) { this._stored = body; }),
      sendResponse: null,
    };
    return res;
  }

  function mockReq(params = {}, query = {}) {
    return { params, query };
  }

  test('calls next and caches response on first request', () => {
    const req = mockReq({ id: '1' }, { year: '2024' });
    const res = makeMockRes();
    const next = vi.fn();
    const middleware = cacheMiddleware('test');

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();

    // Simulate controller calling res.json
    res.json({ result: 'fresh' });
    expect(res._stored).toEqual({ result: 'fresh' });
  });

  test('serves cached response on second request without calling next', () => {
    const req = mockReq({ id: '1' }, { year: '2024' });
    const next1 = vi.fn();
    const next2 = vi.fn();
    const middleware = cacheMiddleware('test2');

    // First request — populates cache
    const res1 = makeMockRes();
    middleware(req, res1, next1);
    res1.json({ result: 'cached' });

    // Second request — should serve from cache
    const res2 = makeMockRes();
    middleware(req, res2, next2);
    expect(next2).not.toHaveBeenCalled();
    expect(res2.json).toHaveBeenCalledWith({ result: 'cached' });
  });

  test('different params produce different cache keys', () => {
    const reqA = mockReq({ id: 'A' }, {});
    const reqB = mockReq({ id: 'B' }, {});
    const middleware = cacheMiddleware('test3');
    const next = vi.fn();

    const resA = makeMockRes();
    middleware(reqA, resA, next);
    resA.json({ val: 'A' });

    const resB = makeMockRes();
    middleware(reqB, resB, vi.fn());
    resB.json({ val: 'B' });

    // Re-request for A should return A's value
    const resA2 = makeMockRes();
    middleware(reqA, resA2, vi.fn());
    expect(resA2.json).toHaveBeenCalledWith({ val: 'A' });
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
