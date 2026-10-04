import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

export const WORKERS = ['service-worker.js', 'admin-service-worker.js'];

export function workerCacheVersion(filename) {
  const file = new URL(`../public/${filename}`, import.meta.url);
  const source = readFileSync(file, 'utf8');
  const { CACHE_NAME, CACHE_PREFIX, STATIC_ASSETS } = runInNewContext(
    `${source}\n;({ CACHE_NAME, CACHE_PREFIX, STATIC_ASSETS });`,
    { self: { addEventListener() {} } },
  );
  const assets = [...STATIC_ASSETS].sort().map((path) => [
    path,
    createHash('sha256')
      .update(readFileSync(new URL(`../public${path}`, import.meta.url)))
      .digest('hex'),
  ]);
  const digest = createHash('sha256')
    .update(JSON.stringify(assets))
    .digest('hex')
    .slice(0, 16);
  return {
    file,
    source,
    current: CACHE_NAME,
    expected: `${CACHE_PREFIX}${digest}`,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  for (const filename of WORKERS) {
    const { file, source, expected } = workerCacheVersion(filename);
    writeFileSync(
      file,
      source.replace(
        /^const CACHE_NAME = '[^']+';/m,
        `const CACHE_NAME = '${expected}';`,
      ),
    );
    process.stdout.write(`${filename}: ${expected}\n`);
  }
}
