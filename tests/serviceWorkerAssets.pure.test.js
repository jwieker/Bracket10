import {
  WORKERS,
  workerCacheVersion,
} from '../scripts/update-service-worker-caches.mjs';

test.each(WORKERS)(
  '%s cache name matches its precached paths and bytes',
  (filename) => {
    const { current, expected } = workerCacheVersion(filename);
    expect(
      current,
      'Precached assets changed. Run node scripts/update-service-worker-caches.mjs and commit the updated workers.',
    ).toBe(expected);
  },
);
