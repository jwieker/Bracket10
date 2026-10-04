import { describe, test, expect, vi, afterEach } from 'vitest';
import {
  isRegistrationOpen,
  bracketLaunchDate,
  tourneyStartDate,
} from '../src/config/app.js';

// #594: isRegistrationOpen() hard-returns true under NODE_ENV=test, and Vitest
// sets NODE_ENV=test, so the two lines that actually decide the window had never
// been executed by any test — every consumer test mocks the function rather than
// calling it. `tests/registrationOpenGuard.test.js` closed the gap for the
// *callers* (the routes honour a closed window); this file closes it for the
// function that decides what "closed" means.
//
// The escape hatch is read from process.env at call time, not captured at import,
// so stubbing the env is enough — no dynamic re-import needed. Fake timers are
// the same pattern as tests/cachePruneTimer.test.js.
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// Drives the real date-window branch by stepping out of the test/development
// escape hatch, then pinning the clock to `at`.
function atInstant(at) {
  vi.stubEnv('NODE_ENV', 'production');
  vi.useFakeTimers();
  vi.setSystemTime(at);
  return isRegistrationOpen();
}

const MINUTE = 60 * 1000;

describe('isRegistrationOpen date window', () => {
  test('closed before bracketLaunchDate', () => {
    expect(atInstant(new Date(bracketLaunchDate.getTime() - MINUTE))).toBe(
      false,
    );
  });

  // The lower bound is `now > bracketLaunchDate` — exclusive. This test is the
  // record that the asymmetry with the inclusive upper bound is deliberate: a
  // "tidy-up" making the two comparisons match would flip behaviour here.
  test('closed exactly at bracketLaunchDate (lower bound is exclusive)', () => {
    expect(atInstant(new Date(bracketLaunchDate.getTime()))).toBe(false);
  });

  test('open mid-window', () => {
    const midpoint = new Date(
      (bracketLaunchDate.getTime() + tourneyStartDate.getTime()) / 2,
    );
    expect(atInstant(midpoint)).toBe(true);
  });

  // The upper bound is `now <= tourneyStartDate` — inclusive. Other half of the
  // asymmetry above.
  test('open exactly at tourneyStartDate (upper bound is inclusive)', () => {
    expect(atInstant(new Date(tourneyStartDate.getTime()))).toBe(true);
  });

  test('closed after tourneyStartDate', () => {
    expect(atInstant(new Date(tourneyStartDate.getTime() + MINUTE))).toBe(
      false,
    );
  });

  test('the window is a non-empty forward interval', () => {
    expect(bracketLaunchDate.getTime()).toBeLessThan(
      tourneyStartDate.getTime(),
    );
  });

  // The season dates are hand-edited literals with explicit -04:00 offsets
  // (EDT — both fall after the 2026 US DST transition on March 8). Nothing else
  // pins that, so a roll-forward that copies the offset onto pre-transition
  // dates, or drops it for a bare local-time string, would shift the window by
  // an hour with a green suite. These assertions are on the resolved instants,
  // so they fail regardless of the machine's local timezone.
  test('season dates resolve to the intended Eastern instants', () => {
    expect(bracketLaunchDate.toISOString()).toBe('2026-03-15T23:00:00.000Z');
    expect(tourneyStartDate.toISOString()).toBe('2026-03-19T16:00:00.000Z');
  });
});

describe('isRegistrationOpen environment escape hatch', () => {
  // Pins the hatch itself so it is not removed by accident: every controller
  // and route test in the suite depends on registration reading as open, and
  // without this nothing would fail if the guard were deleted.
  test.each(['test', 'development'])(
    'returns true under NODE_ENV=%s regardless of the clock',
    (env) => {
      vi.stubEnv('NODE_ENV', env);
      vi.useFakeTimers();
      // Well outside the window — only the escape hatch can produce `true`.
      vi.setSystemTime(new Date(tourneyStartDate.getTime() + 365 * 86400_000));
      expect(isRegistrationOpen()).toBe(true);
    },
  );

  test('does not apply under an unrelated NODE_ENV', () => {
    vi.stubEnv('NODE_ENV', 'staging');
    vi.useFakeTimers();
    vi.setSystemTime(new Date(tourneyStartDate.getTime() + 365 * 86400_000));
    expect(isRegistrationOpen()).toBe(false);
  });
});
