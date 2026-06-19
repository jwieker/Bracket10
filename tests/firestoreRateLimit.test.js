import { firestoreRateLimit } from '../src/middleware/rateLimit.js';
import Logger from '../src/utils/logger.js';

vi.mock('../src/utils/logger.js', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), performance: vi.fn() },
}));

vi.mock('@google-cloud/firestore', () => ({
  Firestore: { Timestamp: { fromMillis: (ms) => ({ __ts: ms }) } },
}));

// Simulates the single Firestore doc touched by incrementWindow.
let stored;
let storeShouldThrow = false;

vi.mock('../src/config/firestore.js', () => {
  const ref = {
    get: vi.fn(async () => ({ exists: stored != null, data: () => stored })),
    set: vi.fn((data) => { stored = data; }),
  };
  const tx = { get: (r) => r.get(), set: (r, data) => r.set(data) };
  return {
    db: {
      collection: () => ({ doc: () => ref }),
      runTransaction: (fn) => {
        if (storeShouldThrow) throw new Error('firestore down');
        return fn(tx);
      },
    },
  };
});

function makeReq(overrides = {}) {
  return { ip: '127.0.0.1', body: {}, ...overrides };
}

function makeRes() {
  return {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
}

describe('firestoreRateLimit', () => {
  beforeEach(() => {
    stored = null;
    storeShouldThrow = false;
    vi.clearAllMocks();
    delete process.env.RATE_LIMIT_FIRESTORE_DISABLED;
  });

  test('rejects invalid configuration', () => {
    const key = () => 'k';
    expect(() => firestoreRateLimit({ windowMs: 0, max: 5, keyGenerator: key })).toThrow();
    expect(() => firestoreRateLimit({ windowMs: 1000, max: 0, keyGenerator: key })).toThrow();
    expect(() => firestoreRateLimit({ windowMs: 1000, max: 5 })).toThrow();
  });

  test('allows requests at or under max', async () => {
    // stored at count 4; incrementWindow returns count 5 (== max, still allowed)
    stored = { count: 4, resetTime: Date.now() + 10000 };
    const limiter = firestoreRateLimit({ windowMs: 1000, max: 5, keyGenerator: (r) => `login:${r.ip}` });
    const next = vi.fn();

    await limiter(makeReq(), makeRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('blocks requests over max with 429 and Retry-After', async () => {
    // stored at count == max; incrementWindow returns count+1 (blocked, no write)
    stored = { count: 5, resetTime: Date.now() + 30000 };
    const limiter = firestoreRateLimit({ windowMs: 1000, max: 5, keyGenerator: () => 'k', message: 'slow down' });
    const next = vi.fn();
    const res = makeRes();

    await limiter(makeReq(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.send).toHaveBeenCalledWith('slow down');
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
  });

  test('fails open and logs when the store throws', async () => {
    storeShouldThrow = true;
    const limiter = firestoreRateLimit({ windowMs: 1000, max: 5, keyGenerator: () => 'k' });
    const next = vi.fn();

    await limiter(makeReq(), makeRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(Logger.error).toHaveBeenCalled();
  });

  test('kill switch bypasses the store entirely', async () => {
    process.env.RATE_LIMIT_FIRESTORE_DISABLED = '1';
    const limiter = firestoreRateLimit({ windowMs: 1000, max: 5, keyGenerator: () => 'k' });
    const next = vi.fn();

    await limiter(makeReq(), makeRes(), next);

    expect(stored).toBeNull();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('keyGenerator can key on entryId for the verify limiter', async () => {
    const limiter = firestoreRateLimit({
      windowMs: 1000,
      max: 10,
      keyGenerator: (r) => `verify:${r.body?.entryId ?? 'unknown'}`,
    });

    await limiter(makeReq({ body: { entryId: '42' } }), makeRes(), vi.fn());
    await limiter(makeReq({ body: {} }), makeRes(), vi.fn());
    // Both should pass (count 1 and 2, well under max:10)
  });
});
