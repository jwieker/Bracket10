import Logger from './logger.js';

const DEFAULT_TTL_SECONDS = 1800; // 30 minute default TTL (busted on game update)

const entries = new Map();
const stats = {
  hits: 0,
  misses: 0,
};

const expiresAtFor = (ttlSeconds = DEFAULT_TTL_SECONDS) => {
  if (!ttlSeconds || ttlSeconds <= 0) return 0;
  return Date.now() + ttlSeconds * 1000;
};

const pruneExpired = () => {
  const now = Date.now();
  for (const [key, entry] of entries) {
    if (entry.expiresAt && entry.expiresAt <= now) {
      entries.delete(key);
    }
  }
};

// Eviction is otherwise lazy and write-driven: `cache.get` only drops the one
// key it was asked for, and the full sweep in `cache.keys()` is reached only
// via `invalidateCache` (repository mutations) or the admin debug middleware.
// A web instance serving pure reads therefore never reaps — and the highest
// cardinality key, `entriesByEmail_{email}_{year}`, is populated by read-only
// requests (`/my-brackets`, signed-in results views), so it grows fastest when
// traffic is heaviest and writes are rarest. A periodic sweep reaps expired
// entries independently of write volume; same pattern and reasoning as the
// rate limiter's `clients` map (`src/middleware/rateLimit.js`). `.unref()` is
// required — without it the timer holds the event loop open and every test
// file importing this module hangs on exit.
setInterval(pruneExpired, DEFAULT_TTL_SECONDS * 1000).unref();

const cache = {
  get(key) {
    const entry = entries.get(key);
    if (!entry) {
      stats.misses += 1;
      return undefined;
    }

    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      entries.delete(key);
      stats.misses += 1;
      return undefined;
    }

    stats.hits += 1;
    return entry.value;
  },

  set(key, value, ttlSeconds = DEFAULT_TTL_SECONDS) {
    entries.set(key, {
      value,
      expiresAt: expiresAtFor(ttlSeconds),
    });
    return true;
  },

  del(key) {
    return entries.delete(key) ? 1 : 0;
  },

  keys() {
    pruneExpired();
    return [...entries.keys()];
  },

  flushAll() {
    entries.clear();
    stats.hits = 0;
    stats.misses = 0;
    return true;
  },

  getStats() {
    return { ...stats };
  },

  getTtl(key) {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      entries.delete(key);
      return undefined;
    }
    return entry.expiresAt || 0;
  },
};

export const invalidateCache = (pattern) => {
  const keys = cache.keys();
  keys.forEach((key) => {
    if (key.includes(pattern)) {
      cache.del(key);
    }
  });
};

export const cacheGet = (key) => {
  const value = cache.get(key);
  if (value !== undefined) {
    Logger.debug(`CACHE HIT: ${key}`);
  } else {
    Logger.debug(`CACHE MISS: ${key}`);
  }
  return value;
};

// Defaults to the named constant rather than repeating the literal (#568).
// `cacheSet` is the only exported way into `cache.set` and it always forwards an
// explicit `ttl`, so `cache.set`'s own `DEFAULT_TTL_SECONDS` default is
// unreachable through the public API — the two values could drift apart and only
// this one would mean anything. Mutation-testing the expiry tests is what
// surfaced it: changing the constant on line 3 killed zero tests.
export const cacheSet = (key, value, ttl = DEFAULT_TTL_SECONDS) => {
  return cache.set(key, value, ttl);
};

export const cacheDel = (key) => {
  return cache.del(key);
};

export const clearAllCache = () => {
  return cache.flushAll();
};

export const cacheDebugMiddleware = (req, res, next) => {
  if (req.session?.siteAdmin && process.env.NODE_ENV !== 'production') {
    const keys = cache.keys();
    res.setHeader('X-Cache-Active-Keys', keys.join(', '));
    res.setHeader('X-Cache-Hits', cache.getStats().hits);
    res.setHeader('X-Cache-Misses', cache.getStats().misses);

    keys.forEach((k) => {
      const ttl = cache.getTtl(k);
      if (ttl) {
        const expiresInSecs = Math.round((ttl - Date.now()) / 1000);
        const safeKey = k.replace(/[^a-zA-Z0-9-]/g, '_');
        res.setHeader(`X-Cache-Expires-${safeKey}`, `${expiresInSecs}s`);
      }
    });
  }
  next();
};
