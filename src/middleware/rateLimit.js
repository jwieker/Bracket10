import ipaddr from 'ipaddr.js';
import { rateLimitRepository } from '../repositories/index.js';
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

/**
 * Atomically reserve an attempt before entry lookup and email comparison.
 * Counts successes too, so concurrent callers cannot exceed the shared budget.
 * Returns true when exhausted. Store errors propagate to stop verification;
 * the explicit RATE_LIMIT_FIRESTORE_DISABLED kill switch remains available.
 */
export async function reserveVerificationAttempt({
  key,
  windowMs,
  max,
  now = Date.now(),
}) {
  if (process.env.RATE_LIMIT_FIRESTORE_DISABLED === '1') {
    return false;
  }
  const { count } = await rateLimitRepository.incrementWindow({
    key,
    windowMs,
    max,
    now,
  });
  return count > max;
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
      result = await rateLimitRepository.incrementWindow({
        key: keyGenerator(req),
        windowMs,
        max,
      });
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
