import {
  checkPackage,
  diffPackages,
  evaluateCooldown,
  evaluatePublisherIdentity,
  extractTopLevelVersions,
  formatMaintainer,
  isKnownMaintainer,
  repositoryUrl,
  sanitizeLogLine,
} from '../scripts/check-dependency-publishers.mjs';

// Covers the pure decision logic behind the dependency cooldown + publisher
// safety gate (docs/development/npm-updates.md). These functions decide
// whether a dependabot/manual dependency bump is allowed to merge, so a
// silent regression here would reopen the supply-chain gap that PR #361
// exposed — hence explicit coverage rather than relying on the manual
// verification the script originally shipped with.

function lockfile(packages) {
  return JSON.stringify({ packages });
}

describe('extractTopLevelVersions', () => {
  test('reads top-level package versions, including scoped packages', () => {
    const text = lockfile({
      '': { name: 'root' },
      'node_modules/vitest': { version: '4.1.9' },
      'node_modules/@typescript-eslint/parser': { version: '8.62.1' },
    });
    expect(extractTopLevelVersions(text)).toEqual({
      vitest: '4.1.9',
      '@typescript-eslint/parser': '8.62.1',
    });
  });

  test("skips packages nested under another package's node_modules", () => {
    const text = lockfile({
      'node_modules/vitest': { version: '4.1.9' },
      'node_modules/vitest/node_modules/estree-walker': { version: '2.0.2' },
    });
    expect(extractTopLevelVersions(text)).toEqual({ vitest: '4.1.9' });
  });

  test('ignores package entries with no version (e.g. the root "" entry)', () => {
    const text = lockfile({ '': { name: 'root' } });
    expect(extractTopLevelVersions(text)).toEqual({});
  });

  test('returns {} for null/empty input', () => {
    expect(extractTopLevelVersions(null)).toEqual({});
    expect(extractTopLevelVersions('')).toEqual({});
  });

  test('throws a clear error on malformed JSON instead of a raw parse crash', () => {
    expect(() => extractTopLevelVersions('{not json')).toThrow(
      /malformed json/i,
    );
  });
});

describe('diffPackages', () => {
  test('reports a changed version with its previous value', () => {
    const changes = diffPackages({ vitest: '4.1.9' }, { vitest: '4.1.10' });
    expect(changes).toEqual([
      { name: 'vitest', baseVersion: '4.1.9', headVersion: '4.1.10' },
    ]);
  });

  test('reports a new package with baseVersion null', () => {
    const changes = diffPackages({}, { vitest: '4.1.10' });
    expect(changes).toEqual([
      { name: 'vitest', baseVersion: null, headVersion: '4.1.10' },
    ]);
  });

  test('does not report a package whose version is unchanged', () => {
    expect(diffPackages({ vitest: '4.1.9' }, { vitest: '4.1.9' })).toEqual([]);
  });
});

describe('isKnownMaintainer — exact match, not substring', () => {
  const maintainers = [
    'ai <andrey@sitnik.es>',
    'antfu <anthonyfu117@hotmail.com>',
  ];

  test('matches on exact email (case-insensitive)', () => {
    expect(isKnownMaintainer('ANDREY@SITNIK.ES', maintainers)).toBe(true);
  });

  test('matches on exact name (case-insensitive)', () => {
    expect(isKnownMaintainer('Antfu', maintainers)).toBe(true);
  });

  test('does not match a short identity that is merely a substring of a maintainer entry', () => {
    // "a" is contained in "ai <andrey@sitnik.es>" but is not the maintainer.
    expect(isKnownMaintainer('a', maintainers)).toBe(false);
  });

  test('does not match an unrelated identity', () => {
    expect(isKnownMaintainer('mallory@evil.example', maintainers)).toBe(false);
  });

  test('returns false for an empty/undefined identity', () => {
    expect(isKnownMaintainer('', maintainers)).toBe(false);
    expect(isKnownMaintainer(undefined, maintainers)).toBe(false);
  });

  test('matches a maintainer entry with no "<email>" suffix by full string', () => {
    expect(isKnownMaintainer('toyobayashi', ['toyobayashi'])).toBe(true);
  });
});

describe('evaluateCooldown', () => {
  const publishedAt = new Date('2026-07-06T06:54:09.239Z');

  test('flags a package published just under the cooldown window', () => {
    const now = new Date(publishedAt.getTime() + 71 * 36e5).getTime();
    const { problem } = evaluateCooldown(publishedAt.toISOString(), { now });
    expect(problem).toMatch(/below the 72h cooldown/);
  });

  test('passes a package published exactly at the cooldown boundary', () => {
    const now = new Date(publishedAt.getTime() + 72 * 36e5).getTime();
    const { problem } = evaluateCooldown(publishedAt.toISOString(), { now });
    expect(problem).toBeNull();
  });

  test('passes a package published comfortably past the cooldown', () => {
    const now = new Date(publishedAt.getTime() + 200 * 36e5).getTime();
    const { problem } = evaluateCooldown(publishedAt.toISOString(), { now });
    expect(problem).toBeNull();
  });

  test('reports an explicit "could not determine" problem for a missing/invalid timestamp, not NaN', () => {
    const { problem } = evaluateCooldown(undefined, { now: Date.now() });
    expect(problem).toMatch(/could not determine publish time/);
    expect(problem).not.toMatch(/NaN/);
  });
});

describe('evaluatePublisherIdentity', () => {
  const maintainers = ['oreanno <foxzdavinci@gmail.com>'];

  test('passes when a human approver matches a registered maintainer', () => {
    const npmUser = {
      name: 'GitHub Actions',
      approver: { name: 'oreanno', email: 'foxzdavinci@gmail.com' },
      trustedPublisher: { id: 'github' },
    };
    const { problems, notices } = evaluatePublisherIdentity(
      npmUser,
      maintainers,
    );
    expect(problems).toEqual([]);
    expect(notices).toEqual([]);
  });

  test('flags when a human approver is not a registered maintainer', () => {
    const npmUser = {
      name: 'GitHub Actions',
      approver: { name: 'mallory', email: 'mallory@evil.example' },
      trustedPublisher: { id: 'github' },
    };
    const { problems } = evaluatePublisherIdentity(npmUser, maintainers);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/mallory@evil.example/);
  });

  test('adds a notice (not a problem) for a CI trusted-publisher with no human approver', () => {
    const npmUser = {
      name: 'GitHub Actions',
      trustedPublisher: { id: 'github' },
    };
    const { problems, notices } = evaluatePublisherIdentity(
      npmUser,
      maintainers,
    );
    expect(problems).toEqual([]);
    expect(notices).toHaveLength(1);
  });

  test('passes when the publisher username matches a maintainer even though the email does not', () => {
    // Real case: eslint-visitor-keys@3.4.3 was published by "eslintbot"
    // under an email the account no longer uses; the username is still in
    // the maintainer list.
    const { problems } = evaluatePublisherIdentity(
      { name: 'oreanno', email: 'old-address@former-employer.example' },
      maintainers,
    );
    expect(problems).toEqual([]);
  });

  test('passes when an approver username matches a maintainer even though the email does not', () => {
    const npmUser = {
      name: 'GitHub Actions',
      approver: {
        name: 'oreanno',
        email: 'old-address@former-employer.example',
      },
      trustedPublisher: { id: 'github' },
    };
    const { problems } = evaluatePublisherIdentity(npmUser, maintainers);
    expect(problems).toEqual([]);
  });

  test('checks classic string-form _npmUser against maintainers', () => {
    const { problems: okProblems } = evaluatePublisherIdentity(
      'oreanno <foxzdavinci@gmail.com>',
      maintainers,
    );
    expect(okProblems).toEqual([]);

    const { problems: badProblems } = evaluatePublisherIdentity(
      'mallory <mallory@evil.example>',
      maintainers,
    );
    expect(badProblems).toHaveLength(1);
  });
});

describe('repositoryUrl', () => {
  test('passes plain-string repository fields through', () => {
    expect(repositoryUrl('git://github.com/a/b.git')).toBe(
      'git://github.com/a/b.git',
    );
  });

  test('extracts url from { url } object form', () => {
    expect(
      repositoryUrl({ type: 'git', url: 'git+https://github.com/a/b.git' }),
    ).toBe('git+https://github.com/a/b.git');
  });

  test('returns null for absent repository fields', () => {
    expect(repositoryUrl(undefined)).toBeNull();
    expect(repositoryUrl(null)).toBeNull();
    expect(repositoryUrl({})).toBeNull();
  });
});

// checkPackage hits the registry through global fetch; stub it with canned
// packuments so these stay network-free like the rest of this file.
describe('checkPackage (stubbed registry)', () => {
  const OLD_DATE = '2020-01-01T00:00:00.000Z'; // far past any cooldown
  const maintainers = [{ name: 'iiroj', email: 'iiro@jappinen.fi' }];
  const npmUser = { name: 'iiroj', email: 'iiro@jappinen.fi' };

  const packument = {
    name: 'demo-pkg',
    maintainers,
    time: { '1.0.0': OLD_DATE, '1.1.0': OLD_DATE },
    versions: {
      '1.0.0': {
        _npmUser: npmUser,
        repository: { url: 'git+https://github.com/demo/pkg.git' },
      },
      '1.1.0': {
        _npmUser: npmUser,
        repository: { url: 'git+https://github.com/evil/pkg.git' },
      },
    },
  };

  function stubRegistry(body) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => body })),
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test('flags a head version missing from the packument as a problem, not a pass', async () => {
    stubRegistry(packument);
    const { problems, error } = await checkPackage({
      name: 'demo-pkg',
      baseVersion: null,
      headVersion: '9.9.9',
    });
    expect(error).toBeNull();
    expect(problems).toEqual([
      'version 9.9.9 not found in the registry packument',
    ]);
  });

  test('flags a repository URL change between base and head versions', async () => {
    stubRegistry(packument);
    const { problems } = await checkPackage({
      name: 'demo-pkg',
      baseVersion: '1.0.0',
      headVersion: '1.1.0',
    });
    expect(problems).toEqual([
      'repository URL changed from git+https://github.com/demo/pkg.git to git+https://github.com/evil/pkg.git between versions',
    ]);
  });

  test('passes a clean head version, skipping repo-continuity when the base version is gone from the packument', async () => {
    stubRegistry(packument);
    const { problems, error } = await checkPackage({
      name: 'demo-pkg',
      baseVersion: '0.9.0', // pruned from the registry
      headVersion: '1.0.0',
    });
    expect(error).toBeNull();
    expect(problems).toEqual([]);
  });

  test('downgrades problems to a notice for an allowlisted name@version', async () => {
    stubRegistry({
      name: 'json-buffer',
      maintainers: [
        { name: 'nopersonsmodules', email: 'nopersonsmodules@gmail.com' },
      ],
      time: { '3.0.1': OLD_DATE },
      versions: {
        '3.0.1': {
          _npmUser: { name: 'dominictarr', email: 'dominic.tarr@gmail.com' },
          repository: {
            url: 'git+https://github.com/dominictarr/json-buffer.git',
          },
        },
      },
    });
    const { problems, notices, error } = await checkPackage({
      name: 'json-buffer',
      baseVersion: null,
      headVersion: '3.0.1',
    });
    expect(error).toBeNull();
    expect(problems).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(
      /^allowlisted despite: published by "dominic.tarr@gmail.com"/,
    );
  });

  test('does not allowlist a different version of an allowlisted package', async () => {
    stubRegistry({
      name: 'json-buffer',
      maintainers: [
        { name: 'nopersonsmodules', email: 'nopersonsmodules@gmail.com' },
      ],
      time: { '3.0.2': OLD_DATE },
      versions: {
        '3.0.2': {
          _npmUser: { name: 'mallory', email: 'mallory@evil.example' },
        },
      },
    });
    const { problems } = await checkPackage({
      name: 'json-buffer',
      baseVersion: null,
      headVersion: '3.0.2',
    });
    expect(problems).toHaveLength(1);
  });

  test('reports a fetch error (not a pass) after exhausting all retries', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNRESET');
      }),
    );
    const promise = checkPackage({
      name: 'demo-pkg',
      baseVersion: null,
      headVersion: '1.0.0',
    });
    await vi.runAllTimersAsync(); // flush the retry backoff sleeps
    const { problems, error } = await promise;
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(problems).toEqual([]);
    expect(error).toMatch(/could not fetch registry metadata .*ECONNRESET/);
  });
});

describe('formatMaintainer', () => {
  test('normalizes packument { name, email } objects to "name <email>"', () => {
    expect(formatMaintainer({ name: 'iiroj', email: 'iiro@jappinen.fi' })).toBe(
      'iiroj <iiro@jappinen.fi>',
    );
  });

  test('passes through already-string entries unchanged', () => {
    expect(formatMaintainer('iiroj <iiro@jappinen.fi>')).toBe(
      'iiroj <iiro@jappinen.fi>',
    );
  });

  test('handles missing email or empty entries without throwing', () => {
    expect(formatMaintainer({ name: 'solo' })).toBe('solo');
    expect(formatMaintainer(null)).toBe('');
  });
});

describe('sanitizeLogLine', () => {
  test('strips newlines and other control characters', () => {
    expect(sanitizeLogLine('evil-pkg\nFAKE PASS line')).toBe(
      'evil-pkg FAKE PASS line',
    );
  });

  test('leaves normal text untouched', () => {
    expect(sanitizeLogLine('vitest@4.1.10 (was 4.1.9) [root]')).toBe(
      'vitest@4.1.10 (was 4.1.9) [root]',
    );
  });
});
