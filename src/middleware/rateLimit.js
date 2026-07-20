import { Firestore } from '@google-cloud/firestore';
import ipaddr from 'ipaddr.js';
import { db } from '../config/firestore.js';
import Logger from '../utils/logger.js';

const DEFAULT_MESSAGE = 'Too many requests. Please try again later.';
const SWEEP_THRESHOLD = 1000;

/**
 * Collapse an IP to its rate-limit bucket key.
 *
 * IPv6 is allocated to end sites in (at least) /64 blocks, so an attacker can
 * trivially rotate through 2^64 fresh source addresses within a single /64 and
 * defeat any per-address limit. Bucketing every IPv6 address to its /64 prefix
 * makes the whole subnet share one counter. IPv4 (and IPv4-mapped IPv6) is
 * returned host-exact since a single v4 address is the smallest routable unit.
 * Unparseable input falls through unchanged so the caller still gets a stable,
 * non-empty key.
 */
export function normalizeIP(ip) {
  if (!ip) return ip;
  try {
    const addr = ipaddr.parse(ip);
    if (addr.kind() === 'ipv6') {
      if (addr.isIPv4MappedAddress()) {
        return addr.toIPv4Address().toString();
      }
      // parts is eight 16-bit words; the first four are the /64 prefix.
      const prefix = addr.parts
        .slice(0, 4)
        .map((part) => part.toString(16))
        .join(':');
      return `${prefix}::/64`;
    }
  } catch {
    /* not a parseable IP — fall through and return as-is */
  }
  return ip;
}

const getClientKey = (req) =>
  normalizeIP(req.ip || req.socket?.remoteAddress || 'unknown');

const sweepExpiredClients = (clients, now) => {
  for (const [key, state] of clients) {
    if (state.resetTime <= now) {
      clients.delete(key);
    }
  }
};

export function rateLimit({
  windowMs,
  max,
  standardHeaders = false,
  legacyHeaders = false,
  message = DEFAULT_MESSAGE,
} = {}) {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error('rateLimit requires a positive windowMs');
  }

  if (!Number.isFinite(max) || max <= 0) {
    throw new Error('rateLimit requires a positive max');
  }

  const clients = new Map();

  // The size-triggered sweep below only fires when a NEW key is inserted past
  // SWEEP_THRESHOLD. Under a rotating-IP flood (trivial with IPv6 /64s, though
  // normalizeIP collapses those) more than SWEEP_THRESHOLD live keys can form
  // inside one window, after which every new request pays an O(n) sweep that
  // removes nothing and the map keeps growing. A periodic timer reaps expired
  // keys independently of insert volume. `.unref()` keeps it from holding the
  // event loop open (e.g. during tests or graceful shutdown).
  setInterval(() => sweepExpiredClients(clients, Date.now()), windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    const key = getClientKey(req);
    let state = clients.get(key);

    if (!state || state.resetTime <= now) {
      if (!state && clients.size >= SWEEP_THRESHOLD) {
        sweepExpiredClients(clients, now);
      }

      state = {
        count: 0,
        resetTime: now + windowMs,
      };
      clients.set(key, state);
    }

    state.count += 1;
    const remaining = Math.max(max - state.count, 0);
    const retryAfterSeconds = Math.ceil((state.resetTime - now) / 1000);

    if (standardHeaders) {
      res.setHeader('RateLimit-Limit', max);
      res.setHeader('RateLimit-Remaining', remaining);
      res.setHeader('RateLimit-Reset', retryAfterSeconds);
    }

    if (legacyHeaders) {
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil(state.resetTime / 1000));
    }

    if (state.count > max) {
      res.setHeader('Retry-After', retryAfterSeconds);
      return res.status(429).send(message);
    }

    return next();
  };
}

// ---------------------------------------------------------------------------
// Firestore-backed global rate limiter
// ---------------------------------------------------------------------------

const COLLECTION = 'rateLimits';

// Firestore doc IDs may not contain "/" and have a length cap. Callers build
// keys from IPs and numeric entry IDs (both safe), but encode defensively so an
// unexpected value can never escape the collection or collide.
function safeDocId(key) {
  return encodeURIComponent(String(key)).slice(0, 256);
}

/**
 * Atomic fixed-window counter shared across all Cloud Run instances.
 *
 * Once the window count has reached `max`, the write is skipped: the request is
 * already blocked, the block decision needs no further state (resetTime is
 * fixed), and skipping avoids hammering a single doc past Firestore's ~1 write/s
 * soft limit.
 */
async function incrementWindow({ key, windowMs, max, now = Date.now() }) {
  const ref = db.collection(COLLECTION).doc(safeDocId(key));

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;

    let count;
    let resetTime;
    if (!data || data.resetTime <= now) {
      count = 1;
      resetTime = now + windowMs;
    } else {
      // Already at/over the cap: return a blocking count without writing.
      if (data.count >= max) {
        return { count: data.count + 1, resetTime: data.resetTime };
      }
      count = data.count + 1;
      resetTime = data.resetTime;
    }

    tx.set(ref, {
      count,
      resetTime,
      // Lets an optional Firestore TTL policy on `expireAt` reap abandoned keys
      // for free. Not required for correctness (windows reset in place).
      expireAt: Firestore.Timestamp.fromMillis(resetTime + windowMs),
    });

    return { count, resetTime };
  });
}

/**
 * Failure-only fixed-window guard, shared globally via Firestore.
 *
 * Unlike `firestoreRateLimit` (middleware that counts EVERY request before the
 * handler runs), this is invoked from inside a controller AFTER it knows an
 * attempt failed, so successful requests never consume the bucket. That closes
 * the lockout DoS where an attacker spends a victim's verify budget with garbage
 * requests and blocks the legitimate owner (#161): a correct verification skips
 * the counter entirely and is never throttled.
 *
 * Returns `true` when the caller should BLOCK (the window is already exhausted).
 * Fails OPEN on store errors and honors the RATE_LIMIT_FIRESTORE_DISABLED kill
 * switch, matching `firestoreRateLimit`.
 */
export async function registerFailedAttempt({
  key,
  windowMs,
  max,
  now = Date.now(),
}) {
  if (process.env.RATE_LIMIT_FIRESTORE_DISABLED === '1') {
    return false;
  }
  try {
    const { count } = await incrementWindow({ key, windowMs, max, now });
    return count > max;
  } catch (err) {
    Logger.error('registerFailedAttempt: store error, failing open', err);
    return false;
  }
}

/**
 * Fixed-window rate limiter backed by Firestore so the limit is GLOBAL across
 * all Cloud Run instances. Use for low-volume, security-sensitive routes (auth,
 * entry verification) where the limit must be exact.
 *
 * Fails OPEN on store errors. Kill switch: set
 * `RATE_LIMIT_FIRESTORE_DISABLED=1` to bypass the store entirely.
 */
export function firestoreRateLimit({
  windowMs,
  max,
  keyGenerator,
  message = DEFAULT_MESSAGE,
  standardHeaders = true,
} = {}) {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error('firestoreRateLimit requires a positive windowMs');
  }
  if (!Number.isFinite(max) || max <= 0) {
    throw new Error('firestoreRateLimit requires a positive max');
  }
  if (typeof keyGenerator !== 'function') {
    throw new Error('firestoreRateLimit requires a keyGenerator function');
  }

  return async (req, res, next) => {
    if (process.env.RATE_LIMIT_FIRESTORE_DISABLED === '1') {
      return next();
    }

    let result;
    try {
      result = await incrementWindow({ key: keyGenerator(req), windowMs, max });
    } catch (err) {
      Logger.error('firestoreRateLimit: store error, failing open', err);
      return next();
    }

    const { count, resetTime } = result;
    const remaining = Math.max(max - count, 0);
    const retryAfterSeconds = Math.max(
      0,
      Math.ceil((resetTime - Date.now()) / 1000),
    );

    if (standardHeaders) {
      res.setHeader('RateLimit-Limit', max);
      res.setHeader('RateLimit-Remaining', remaining);
      res.setHeader('RateLimit-Reset', retryAfterSeconds);
    }

    if (count > max) {
      res.setHeader('Retry-After', retryAfterSeconds);
      return res.status(429).send(message);
    }

    return next();
  };
}
