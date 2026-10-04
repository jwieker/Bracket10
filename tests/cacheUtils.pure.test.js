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

// #556 — TTL expiry had no coverage at all, which matters more than the
// percentage suggests: the poll job runs in its own container and each web
// instance keeps a private cache, so cross-process freshness is bounded ONLY by
// these TTLs (hierarchicalRepository.js:205-209). If expiry silently stopped
// working — an inverted comparison, a seconds/milliseconds mix-up, a truthiness
// bug on expiresAt — the suite would stay green and live standings would freeze
// on every instance until it was recycled.
//
// getTtl and getStats aren't exported, so the assertions below read them through
// cacheDebugMiddleware, which is their only production surface.
describe('cache TTL expiry', () => {
  const BASE = new Date('2026-03-15T12:00:00Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    // Ordering matters: the outer beforeEach already ran, so re-clear here to
    // zero the hit/miss counters as of the frozen clock.
    clearAllCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function readDebugHeaders() {
    const headers = {};
    cacheDebugMiddleware(
      { session: { siteAdmin: true } },
      {
        setHeader: (k, v) => {
          headers[k] = v;
        },
      },
      () => {},
    );
    return headers;
  }

  test('a value survives until its TTL and is gone after it', () => {
    cacheSet('live_scores', { rank: 1 }, 300);

    vi.setSystemTime(BASE + 299_000);
    expect(cacheGet('live_scores')).toEqual({ rank: 1 });

    vi.setSystemTime(BASE + 301_000);
    expect(cacheGet('live_scores')).toBeUndefined();
  });

  // The comparison is `expiresAt <= now`, so the TTL boundary itself is expired.
  // Pinned because an off-by-one here is invisible in normal use.
  test('the entry is already expired at exactly its expiry instant', () => {
    cacheSet('boundary', 'v', 300);

    vi.setSystemTime(BASE + 300_000);

    expect(cacheGet('boundary')).toBeUndefined();
  });

  // Rewinding the clock is the only way to tell deletion from hiding: every other
  // observation path (cache.keys, and so X-Cache-Active-Keys) prunes as it reads,
  // so it reports the key gone either way. If the expiring read had merely hidden
  // the entry, moving back inside the original window would resurrect it.
  test('an expired read deletes the entry rather than hiding it', () => {
    cacheSet('evicted', 'v', 300);

    vi.setSystemTime(BASE + 400_000);
    expect(cacheGet('evicted')).toBeUndefined();

    vi.setSystemTime(BASE + 100_000);
    expect(cacheGet('evicted')).toBeUndefined();
  });

  // A hit counted on an expired key would make the debug headers lie about how
  // well the cache is working.
  test('an expired read counts as a miss, not a hit', () => {
    cacheSet('stale', 'v', 300);
    vi.setSystemTime(BASE + 400_000);

    cacheGet('stale');

    const headers = readDebugHeaders();
    expect(headers['X-Cache-Hits']).toBe(0);
    expect(headers['X-Cache-Misses']).toBe(1);
  });

  test('pruning leaves live entries alone and drops only expired ones', () => {
    cacheSet('short_lived', 'gone', 300);
    cacheSet('long_lived', 'kept', 3600);
    vi.setSystemTime(BASE + 400_000);

    // invalidateCache is pruneExpired's only production caller; a non-matching
    // pattern isolates the pruning from the deletion it normally does.
    invalidateCache('no_such_key');

    // Asserted through cacheGet rather than the keys header because the header's
    // own keys() call prunes, which would pass whether or not invalidateCache did.
    // "Live entry survives" is the half that catches an inverted comparison.
    expect(cacheGet('long_lived')).toBe('kept');
    expect(cacheGet('short_lived')).toBeUndefined();
  });

  test('the debug headers expose a remaining TTL for live keys and omit expired ones', () => {
    cacheSet('reported', 'v', 300);
    cacheSet('expired', 'v', 60);

    vi.setSystemTime(BASE + 100_000);
    const headers = readDebugHeaders();

    expect(headers['X-Cache-Active-Keys']).toBe('reported');
    expect(headers['X-Cache-Expires-reported']).toBe('200s');
    expect(headers).not.toHaveProperty('X-Cache-Expires-expired');
  });

  // expiresAtFor returns 0 for any non-positive TTL and every read guards with
  // `if (entry.expiresAt && ...)`, so 0 is a deliberate never-expires sentinel.
  // Nothing documented it, and 0 is the obvious value to reach for meaning
  // "expire immediately" — pinning it so the next reader can't quietly invert it.
  test.each([0, -1])(
    'a TTL of %i means never expires, not immediately',
    (ttl) => {
      cacheSet('sentinel', 'forever', ttl);

      vi.setSystemTime(BASE + 10 * 365 * 24 * 60 * 60 * 1000);

      expect(cacheGet('sentinel')).toBe('forever');
      // getTtl returns 0 for these, which the middleware's `if (ttl)` treats as
      // falsy — a never-expiring key deliberately gets no expiry header.
      expect(readDebugHeaders()).not.toHaveProperty('X-Cache-Expires-sentinel');
    },
  );

  // 1800s is what the 24h and 300s call sites are all deviating *from*.
  test('the default TTL is 1800s when the argument is omitted', () => {
    cacheSet('defaulted', 'v');

    vi.setSystemTime(BASE + 1_799_000);
    expect(cacheGet('defaulted')).toBe('v');

    vi.setSystemTime(BASE + 1_800_000);
    expect(cacheGet('defaulted')).toBeUndefined();
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

  // #481: this is the one branch that actually prevents X-Cache-Active-Keys
  // (which can contain participant PII, e.g. entriesByEmail_* keys) from
  // being echoed in a production response, even to a site admin.
  test('skips cache headers for admin in production', () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      cacheSet('debug_key', 'value');
      const req = { session: { siteAdmin: true } };
      const res = { setHeader: vi.fn() };
      const next = vi.fn();

      cacheDebugMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.setHeader).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
});
