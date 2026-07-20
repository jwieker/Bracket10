// A fake Firestore that runs the transaction callback against an in-memory doc,
// letting us assert the fixed-window increment/reset logic without a real DB.
let stored; // simulates the single doc this test touches

vi.mock('@google-cloud/firestore', () => ({
  Firestore: { Timestamp: { fromMillis: (ms) => ({ __ts: ms }) } },
}));

vi.mock('../src/config/firestore.js', () => {
  const ref = {
    get: vi.fn(async () => ({ exists: stored != null, data: () => stored })),
    set: vi.fn((data) => {
      stored = data;
    }),
  };
  const tx = { get: (r) => r.get(), set: (r, data) => r.set(data) };
  return {
    db: {
      collection: () => ({ doc: () => ref }),
      runTransaction: (fn) => fn(tx),
    },
  };
});

import { registerFailedAttempt } from '../src/middleware/rateLimit.js';

describe('registerFailedAttempt', () => {
  beforeEach(() => {
    stored = null;
  });

  test('starts a window at count 1 when no doc exists', async () => {
    const now = 1_000_000;
    const result = await registerFailedAttempt({
      key: 'login:1.2.3.4',
      windowMs: 10_000,
      max: 5,
      now,
    });
    expect(result).toBe(false);
    expect(stored.count).toBe(1);
    expect(stored.expireAt).toEqual({ __ts: now + 20_000 });
  });

  test('increments within the same window and keeps resetTime', async () => {
    const now = 1_000_000;
    await registerFailedAttempt({ key: 'k', windowMs: 10_000, max: 5, now });
    const second = await registerFailedAttempt({
      key: 'k',
      windowMs: 10_000,
      max: 5,
      now: now + 5_000,
    });
    expect(second).toBe(false);
    expect(stored.count).toBe(2);
  });

  test('resets to count 1 once the window has elapsed', async () => {
    const now = 1_000_000;
    await registerFailedAttempt({ key: 'k', windowMs: 10_000, max: 5, now });
    const later = await registerFailedAttempt({
      key: 'k',
      windowMs: 10_000,
      max: 5,
      now: now + 10_001,
    });
    expect(later).toBe(false);
    expect(stored.count).toBe(1);
  });

  test('skips the write once count has reached max (no contention under flood)', async () => {
    const now = 1_000_000;
    await registerFailedAttempt({ key: 'k', windowMs: 10_000, max: 2, now }); // count 1, writes
    await registerFailedAttempt({
      key: 'k',
      windowMs: 10_000,
      max: 2,
      now: now + 1_000,
    }); // count 2 (== max), writes
    expect(stored.count).toBe(2);

    // Already at max: returns a blocking count but must NOT write.
    const blocked = await registerFailedAttempt({
      key: 'k',
      windowMs: 10_000,
      max: 2,
      now: now + 2_000,
    });
    expect(blocked).toBe(true);
    expect(stored.count).toBe(2);
  });
});
