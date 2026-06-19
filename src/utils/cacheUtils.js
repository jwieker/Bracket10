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
    keys.forEach(key => {
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

export const cacheSet = (key, value, ttl = 1800) => {
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

        keys.forEach(k => {
            const ttl = cache.getTtl(k);
            if (ttl) {
                const expiresInSecs = Math.round((ttl - Date.now()) / 1000);
                const safeKey = k.replace(/[^a-zA-Z0-9\-]/g, '_');
                res.setHeader(`X-Cache-Expires-${safeKey}`, `${expiresInSecs}s`);
            }
        });
    }
    next();
};
