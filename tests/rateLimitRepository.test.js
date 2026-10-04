// A fake Firestore that runs the transaction callback against an in-memory doc,
// letting us assert the fixed-window increment/reset logic without a real DB.
let stored; // simulates the single doc this test touches
let storeError;

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
      runTransaction: (fn) => {
        if (storeError) throw storeError;
        return fn(tx);
      },
    },
  };
});

import { reserveVerificationAttempt } from '../src/middleware/rateLimit.js';
import { myEntryVerify } from '../src/controllers/selfServiceController.js';
import { gameRepository } from '../src/repositories/index.js';

vi.mock('../src/services/index.js', () => ({}));
// Keep the REAL RateLimitRepository so the fixed-window transaction logic below
// is actually exercised against the mocked db above; only gameRepository is a stub.
vi.mock('../src/repositories/index.js', async () => {
  const actual = await vi.importActual(
    '../src/repositories/hierarchicalRepository.js',
  );
  return {
    gameRepository: { getEntryById: vi.fn() },
    rateLimitRepository: new actual.RateLimitRepository(),
  };
});
vi.mock('../src/config/app.js', () => ({
  // `tournament` is read at hierarchicalRepository module load, which this file
  // now imports for the real RateLimitRepository.
  APP_CONFIG: { tournament: { excludedGroups: [] } },
  thisYear: 2026,
  isRegistrationOpen: () => true,
}));

function verification(email) {
  const req = {
    method: 'POST',
    url: '/my-entry/verify',
    body: { entryId: '123', year: '2026', email },
    session: { regenerate: vi.fn((cb) => cb()), save: vi.fn((cb) => cb()) },
  };
  const res = {
    status: vi.fn().mockReturnThis(),
    set: vi.fn(),
    render: vi.fn(),
    redirect: vi.fn(),
    json: vi.fn(),
  };
  return { req, res };
}

describe('reserveVerificationAttempt', () => {
  beforeEach(() => {
    stored = null;
    storeError = null;
    vi.clearAllMocks();
    vi.stubEnv('RATE_LIMIT_FIRESTORE_DISABLED', '0');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  test('exhausted guesses block even the correct email until expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T12:00:00Z'));
    gameRepository.getEntryById.mockResolvedValue({
      id: '123',
      email: 'owner@example.com',
    });
    for (let i = 0; i < 5; i++) {
      const { req, res } = verification('wrong@example.com');
      await myEntryVerify(req, res);
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('error=invalid'),
      );
    }
    const { req, res } = verification('owner@example.com');
    await myEntryVerify(req, res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(gameRepository.getEntryById).toHaveBeenCalledTimes(5);
    expect(req.session.regenerate).not.toHaveBeenCalled();
    expect(req.session.verifiedEntries).toBeUndefined();
    expect(stored.count).toBe(5);

    vi.setSystemTime(Date.now() + 15 * 60 * 1000);
    await myEntryVerify(req, res);
    expect(req.session.verifiedEntries).toEqual({ '2026:123': true });
    expect(res.redirect).toHaveBeenCalledWith(
      '/my-entry/edit?entryId=123&year=2026',
    );
    expect(stored.count).toBe(1);
  });

  test('a counter outage stops verification before the credential read', async () => {
    storeError = new Error('store unavailable');
    const { req, res } = verification('owner@example.com');
    await myEntryVerify(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(gameRepository.getEntryById).not.toHaveBeenCalled();
    expect(req.session.regenerate).not.toHaveBeenCalled();
  });

  test('the kill switch allows verification during a counter outage', async () => {
    vi.stubEnv('RATE_LIMIT_FIRESTORE_DISABLED', '1');
    storeError = new Error('store unavailable');
    gameRepository.getEntryById.mockResolvedValue({
      id: '123',
      email: 'owner@example.com',
    });
    const { req, res } = verification('owner@example.com');
    await myEntryVerify(req, res);
    expect(gameRepository.getEntryById).toHaveBeenCalledWith('123', '2026');
    expect(req.session.verifiedEntries).toEqual({ '2026:123': true });
    expect(req.session.save).toHaveBeenCalledTimes(1);
    expect(res.redirect).toHaveBeenCalledWith(
      '/my-entry/edit?entryId=123&year=2026',
    );
    expect(stored).toBeNull();
  });

  test('starts a window at count 1 when no doc exists', async () => {
    const now = 1_000_000;
    const result = await reserveVerificationAttempt({
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
    await reserveVerificationAttempt({
      key: 'k',
      windowMs: 10_000,
      max: 5,
      now,
    });
    const second = await reserveVerificationAttempt({
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
    await reserveVerificationAttempt({
      key: 'k',
      windowMs: 10_000,
      max: 5,
      now,
    });
    const later = await reserveVerificationAttempt({
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
    await reserveVerificationAttempt({
      key: 'k',
      windowMs: 10_000,
      max: 2,
      now,
    }); // count 1, writes
    await reserveVerificationAttempt({
      key: 'k',
      windowMs: 10_000,
      max: 2,
      now: now + 1_000,
    }); // count 2 (== max), writes
    expect(stored.count).toBe(2);

    // Already at max: returns a blocking count but must NOT write.
    const blocked = await reserveVerificationAttempt({
      key: 'k',
      windowMs: 10_000,
      max: 2,
      now: now + 2_000,
    });
    expect(blocked).toBe(true);
    expect(stored.count).toBe(2);
  });
});
