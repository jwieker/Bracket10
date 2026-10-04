import { describe, test, expect, vi, afterEach } from 'vitest';

// The sweep timer is registered at module scope, so the fake clock has to be
// installed *before* the module is imported — a normal static import would
// capture the real `setInterval` and the sweep would never fire under
// `vi.advanceTimersByTime`. Hence the dynamic import inside each test, and the
// separate file: `tests/cacheUtils.pure.test.js` imports the module statically.
const importCacheUtils = async () => await import('../src/utils/cacheUtils.js');

const SWEEP_INTERVAL_MS = 1800 * 1000; // DEFAULT_TTL_SECONDS, module-private

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

describe('periodic prune timer', () => {
  test('reaps an expired entry with no intervening read or write', async () => {
    vi.useFakeTimers();
    const { cacheSet, cacheGet } = await importCacheUtils();

    const start = Date.now();
    cacheSet('expiring', 'value', 60);

    // Nothing touches the cache in between: this is the read-only-instance case
    // where lazy eviction never runs.
    vi.advanceTimersByTime(SWEEP_INTERVAL_MS);

    // Rewind to inside the original TTL window. Every observation path
    // (`get`, `keys`, `getTtl`) prunes as it reads, so an entry that was merely
    // hidden by the clock would be served again here; a deleted one stays gone.
    // That is the only way to tell "swept" from "expired but still resident".
    vi.setSystemTime(start + 1000);
    expect(cacheGet('expiring')).toBeUndefined();
  });

  test('leaves a still-live entry alone', async () => {
    vi.useFakeTimers();
    const { cacheSet, cacheGet } = await importCacheUtils();

    cacheSet('long-lived', 'value', 7200);
    vi.advanceTimersByTime(SWEEP_INTERVAL_MS);

    expect(cacheGet('long-lived')).toBe('value');
  });
});

// Not asserted here: that the timer is `.unref()`d. `getActiveResourcesInfo`
// also reports vitest's own timers, so the check was measuring the runner
// rather than this module. The real signal is the full suite still exiting on
// its own — a ref'd 30-minute interval would hang every file importing this.
