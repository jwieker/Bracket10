const DEFAULT_MESSAGE = "Too many requests. Please try again later.";
const SWEEP_THRESHOLD = 1000;

const getClientKey = (req) => (
  req.ip
  || req.socket?.remoteAddress
  || "unknown"
);

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
    throw new Error("rateLimit requires a positive windowMs");
  }

  if (!Number.isFinite(max) || max <= 0) {
    throw new Error("rateLimit requires a positive max");
  }

  const clients = new Map();

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
      res.setHeader("RateLimit-Limit", max);
      res.setHeader("RateLimit-Remaining", remaining);
      res.setHeader("RateLimit-Reset", retryAfterSeconds);
    }

    if (legacyHeaders) {
      res.setHeader("X-RateLimit-Limit", max);
      res.setHeader("X-RateLimit-Remaining", remaining);
      res.setHeader("X-RateLimit-Reset", Math.ceil(state.resetTime / 1000));
    }

    if (state.count > max) {
      res.setHeader("Retry-After", retryAfterSeconds);
      return res.status(429).send(message);
    }

    return next();
  };
}
