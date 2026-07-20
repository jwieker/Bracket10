#!/usr/bin/env node
// Enforces the cooldown + publisher-identity checks from docs/development/npm-updates.md
// against every package version that changed in a PR's lockfile(s). Run in CI on pull
// requests that touch package-lock.json so a fresh or identity-mismatched release blocks
// merge instead of relying on a human to run `npm view` by hand.
//
// Registry metadata is fetched straight from the packument
// (https://registry.npmjs.org/<name>) rather than via `npm view`: npm 11
// collapses `_npmUser` to a "name <email>" string on output — even with
// --json, even queried as a single field — which silently discards the
// trustedPublisher / approver metadata the publisher check depends on and
// made every OIDC trusted-publishing release look like an unknown publisher.

import { execFileSync } from 'node:child_process';

const COOLDOWN_HOURS = 72;
const REGISTRY_URL = 'https://registry.npmjs.org';
const REGISTRY_RETRIES = 3;
const REGISTRY_RETRY_DELAY_MS = 500;

const LOCKFILES = [
  { label: 'root', path: 'package-lock.json' },
  { label: 'jobs', path: 'jobs/package-lock.json' },
];

// Strips control characters (including newlines) from strings that embed
// registry/lockfile data before they hit console.log, so a crafted package
// name or maintainer field can't forge extra log lines. Same approach as
// sanitizeLogField in src/middleware/securityHeaders.js (CWE-117).
export function sanitizeLogLine(str) {
  return (
    String(str)
      // eslint-disable-next-line no-control-regex -- intentional: strip raw control bytes from attacker-influenced log fields (see note above)
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function gitShow(ref, path) {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 64,
    });
  } catch {
    return null;
  }
}

// Fetches the full packument for a package. Retries transient failures
// (network blips, registry rate-limiting) before giving up. Returns
// { ok: true, data } on success or { ok: false, error } so callers can tell
// "couldn't verify" apart from "verification failed".
async function fetchPackument(name) {
  // Scoped packages keep the '@' but escape the inner slash: @scope%2Fname.
  const url = `${REGISTRY_URL}/${name.replace('/', '%2F')}`;
  let lastError;
  for (let attempt = 1; attempt <= REGISTRY_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`registry returned HTTP ${res.status}`);
      return { ok: true, data: await res.json() };
    } catch (err) {
      lastError = err;
      if (attempt < REGISTRY_RETRIES)
        await sleep(REGISTRY_RETRY_DELAY_MS * attempt);
    }
  }
  return {
    ok: false,
    error: lastError?.message ?? 'unknown registry fetch failure',
  };
}

// Packument maintainer entries are { name, email } objects; normalize to the
// "name <email>" string form the identity checks (and failure messages) use.
export function formatMaintainer(entry) {
  if (typeof entry === 'string') return entry;
  if (!entry) return '';
  const name = entry.name ?? '';
  return entry.email ? `${name} <${entry.email}>`.trim() : name;
}

// Version manifests carry `repository` as either a string or a { url } object.
export function repositoryUrl(repository) {
  return typeof repository === 'string'
    ? repository
    : (repository?.url ?? null);
}

export function extractTopLevelVersions(lockfileText) {
  if (!lockfileText) return {};
  let lock;
  try {
    lock = JSON.parse(lockfileText);
  } catch {
    throw new Error(
      'Malformed JSON in lockfile — cannot diff dependency versions.',
    );
  }
  const versions = {};
  for (const [key, info] of Object.entries(lock.packages ?? {})) {
    if (!key.startsWith('node_modules/')) continue;
    const name = key.slice('node_modules/'.length);
    // Skip transitive deps nested under another package's node_modules — we only
    // want the packages that show up as direct top-level entries in the tree.
    if (name.includes('/node_modules/')) continue;
    if (info?.version) versions[name] = info.version;
  }
  return versions;
}

export function diffPackages(baseVersions, headVersions) {
  const changes = [];
  for (const [name, headVersion] of Object.entries(headVersions)) {
    const baseVersion = baseVersions[name] ?? null;
    if (baseVersion !== headVersion) {
      changes.push({ name, baseVersion, headVersion });
    }
  }
  return changes;
}

// Splits a "name <email>" registry-style identity string into its parts.
// Falls back to treating the whole string as the name when there's no
// "<email>" suffix (e.g. a maintainer entry with no email on file).
function parseNameEmail(entry) {
  const match = /^(.*?)\s*<(.+)>$/.exec(String(entry).trim());
  if (match) {
    return { name: match[1] || null, email: match[2] };
  }
  return { name: String(entry).trim(), email: null };
}

// Exact (not substring) match of a publishing identity against the
// package's registered maintainers, which are formatted "name <email>".
// Matches on either the parsed name or the parsed email so a short/common
// identity (e.g. a one-letter npm username) can't accidentally satisfy the
// check just by appearing inside a longer maintainer string.
export function isKnownMaintainer(identity, maintainers) {
  if (!identity) return false;
  const target = String(identity).toLowerCase();
  return maintainers.some((m) => {
    const { name, email } = parseNameEmail(m);
    return target === email?.toLowerCase() || target === name?.toLowerCase();
  });
}

export function evaluateCooldown(
  timeModified,
  { now = Date.now(), cooldownHours = COOLDOWN_HOURS } = {},
) {
  const publishedAt = new Date(timeModified);
  const ageHours = (now - publishedAt.getTime()) / 36e5;

  if (!Number.isFinite(ageHours)) {
    return {
      problem: `could not determine publish time (registry returned "${timeModified}")`,
    };
  }
  if (ageHours < cooldownHours) {
    return {
      problem: `published ${ageHours.toFixed(1)}h ago (${publishedAt.toISOString()}) — below the ${cooldownHours}h cooldown`,
    };
  }
  return { problem: null };
}

// Classic (non-OIDC) publishes report `_npmUser` as a "name <email>" string
// rather than an object; normalize so the checks below have a stable shape.
export function evaluatePublisherIdentity(rawNpmUser, maintainers) {
  const problems = [];
  const notices = [];
  const npmUser =
    typeof rawNpmUser === 'string'
      ? parseNameEmail(rawNpmUser)
      : (rawNpmUser ?? {});
  const approver = npmUser.approver;

  if (approver) {
    const identity = approver.email || approver.name;
    if (!isKnownMaintainer(identity, maintainers)) {
      problems.push(
        `publish was approved by "${identity}", who is not in the registered maintainer list (${maintainers.join(', ') || 'none listed'})`,
      );
    }
  } else if (npmUser.trustedPublisher) {
    // Fully automated CI publish with no recorded human approver. Trusted
    // Publishing is opt-in per package (a maintainer must wire up the OIDC
    // config on npm), so this is expected for some projects — flag it for
    // awareness rather than failing the build.
    notices.push(
      `published via CI trusted publisher with no human approver on record (${npmUser.name ?? 'unknown'}) — confirm this package normally publishes this way`,
    );
  } else {
    const identity = npmUser.email || npmUser.name;
    if (!isKnownMaintainer(identity, maintainers)) {
      problems.push(
        `published by "${identity}", who is not in the registered maintainer list (${maintainers.join(', ') || 'none listed'})`,
      );
    }
  }

  return { problems, notices };
}

export async function checkPackage({ name, baseVersion, headVersion }) {
  const packResult = await fetchPackument(name);

  if (!packResult.ok) {
    return {
      problems: [],
      notices: [],
      error: `could not fetch registry metadata for ${name} after ${REGISTRY_RETRIES} attempts (${packResult.error})`,
    };
  }

  const packument = packResult.data;
  const problems = [];
  const notices = [];

  const headManifest = packument.versions?.[headVersion];
  if (!headManifest) {
    // A version present in the lockfile but absent from the registry is a
    // red flag on its own (unpublished/yanked release, or a lockfile
    // pointing somewhere the registry doesn't know about).
    problems.push(`version ${headVersion} not found in the registry packument`);
    return { problems, notices, error: null };
  }

  // Publish time comes from the packument's per-version `time` map — NOT
  // `time.modified`, which is the packument-level last-modified date (the
  // newest release of ANY version) and judges non-latest versions (e.g. a
  // deliberate downgrade to clear the cooldown) by the wrong release's age.
  const { problem: cooldownProblem } = evaluateCooldown(
    packument.time?.[headVersion],
  );
  if (cooldownProblem) problems.push(cooldownProblem);

  const maintainers = (packument.maintainers ?? []).map(formatMaintainer);
  const identityResult = evaluatePublisherIdentity(
    headManifest._npmUser,
    maintainers,
  );
  problems.push(...identityResult.problems);
  notices.push(...identityResult.notices);

  if (baseVersion) {
    const baseRepo = repositoryUrl(
      packument.versions?.[baseVersion]?.repository,
    );
    const headRepo = repositoryUrl(headManifest.repository);
    if (baseRepo && headRepo && baseRepo !== headRepo) {
      problems.push(
        `repository URL changed from ${baseRepo} to ${headRepo} between versions`,
      );
    }
    // If the base version is missing from the packument, we don't block on
    // the repository-continuity check alone — the cooldown/identity checks
    // above already ran against the head version and are the primary gate.
  }

  return { problems, notices, error: null };
}

async function main() {
  const baseRef = process.env.BASE_SHA;
  const headRef = process.env.HEAD_SHA;

  if (!baseRef || !headRef) {
    console.error('BASE_SHA and HEAD_SHA env vars are required.');
    process.exit(2);
  }

  const allChanges = [];
  for (const lockfile of LOCKFILES) {
    const baseText = gitShow(baseRef, lockfile.path);
    const headText = gitShow(headRef, lockfile.path);
    if (!headText) continue;

    const baseVersions = extractTopLevelVersions(baseText);
    const headVersions = extractTopLevelVersions(headText);
    for (const change of diffPackages(baseVersions, headVersions)) {
      allChanges.push({ ...change, lockfile: lockfile.label });
    }
  }

  if (allChanges.length === 0) {
    console.log('No dependency version changes detected — nothing to check.');
    return;
  }

  console.log(
    `Checking ${allChanges.length} changed package(s) against the cooldown + publisher rules in docs/development/npm-updates.md...\n`,
  );

  let failed = false;
  let hadErrors = false;
  for (const change of allChanges) {
    const { problems, notices, error } = await checkPackage(change);
    const header = sanitizeLogLine(
      `${change.name}@${change.headVersion}` +
        (change.baseVersion ? ` (was ${change.baseVersion})` : ' (new)') +
        ` [${change.lockfile}]`,
    );

    if (error) {
      hadErrors = true;
      console.log(`ERROR ${header}`);
      console.log(sanitizeLogLine(`      - ${error}`));
      continue;
    }

    if (problems.length === 0) {
      console.log(`PASS  ${header}`);
    } else {
      failed = true;
      console.log(`FAIL  ${header}`);
      for (const problem of problems)
        console.log(sanitizeLogLine(`      - ${problem}`));
    }
    for (const notice of notices)
      console.log(sanitizeLogLine(`      note: ${notice}`));
  }

  if (hadErrors) {
    console.log(
      '\nOne or more packages could not be verified against the npm registry after ' +
        `${REGISTRY_RETRIES} attempts each (network/registry issue, not a confirmed security ` +
        'finding). Re-run the check before treating this as safe.',
    );
  }
  if (failed) {
    console.log(
      '\nOne or more dependency updates failed the cooldown/publisher checks. ' +
        'Do not merge until the cooldown clears or the publisher mismatch is investigated ' +
        '(see docs/development/npm-updates.md).',
    );
  }
  if (failed || hadErrors) {
    process.exit(1);
  }

  console.log(
    '\nAll changed dependencies passed the cooldown and publisher checks.',
  );
}

// Only run when executed directly (`node scripts/check-dependency-publishers.mjs`),
// not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
