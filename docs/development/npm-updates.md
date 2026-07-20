---
tags: [development, npm, supply-chain, security]
updated: 2026-05-16
---

# Safe npm Update Procedure

Read this any time you intend to run `npm install`, `npm update`, `npm ci`, or add/bump a dependency in either `package.json` (root) or `jobs/package.json`. The goal is to stay safe against supply-chain attacks of the Shai-Hulud class (compromised maintainer credentials publish a trojanized version whose `postinstall` runs the moment you install).

## Standing posture

- `.npmrc` files at the repo root and in `jobs/` set `ignore-scripts=true`. **Do not remove or override this.** Every `npm install` / `npm update` / `npm ci` in this repo must run with install scripts disabled by default.
- If a tool ever requires the flag to be off (very rare), pass `--ignore-scripts=false` for that one command — do not edit `.npmrc`.

## The update workflow

Follow these steps in order. Do not skip the audit or the cooldown check.

### 1. List what would change

```bash
npm outdated                # in repo root
cd jobs && npm outdated     # in jobs/
```

`npm update` only walks within the existing semver ranges in `package.json`. Anything in the "Wanted" column will be installed; anything in "Latest" beyond that is a major bump that needs a deliberate decision (see "Major version bumps" below).

### 2. Check the cooldown window

For every package about to change, confirm the target version is **at least 72 hours old** and was published by an expected account:

```bash
npm view <pkg> time --json | grep '"<version>"'   # per-version publish date
curl -s https://registry.npmjs.org/<pkg> | jq '.versions["<version>"]._npmUser'
```

Two traps to avoid here: `time.modified` is the packument-level last-modified date (the newest release of _any_ version), so it reports the wrong age for anything but the latest version — always read the per-version `time` map. And `npm view`'s `_npmUser` output is unreliable on npm 11, which collapses it to a `"name <email>"` string and silently drops the `trustedPublisher` / `approver` metadata that distinguishes a legitimate OIDC trusted-publishing release (how prettier publishes, for example) from an unknown publisher — read `_npmUser` from the raw packument instead, as above.

If a target version is fresher than 72h, wait. Compromised releases are usually yanked within a day or two; the cooldown is the cheapest defense against installing one. If the publisher is not the expected maintainer / org, stop and investigate.

This check also runs automatically in CI: `.github/workflows/dependency-publisher-check.yml` diffs `package-lock.json` (root and `jobs/`) on every PR against `main` and runs `scripts/check-dependency-publishers.mjs`, which fails the check if any changed package — including transitive ones dependabot's grouping doesn't surface individually — is younger than 72h or was published by an identity absent from the package's registered maintainer list. Treat a red check the same as a manual cooldown failure: wait it out or investigate, don't override it. It's a backstop, not a replacement for `dependabot.yml`'s own `cooldown` setting or for reading a change before merging it.

**Run the same check locally before pushing**, rather than waiting on a CI round-trip. It reads
lockfile contents via `git show <ref>:<path>`, so it needs both refs to already be commits —
commit the lockfile change first (you can amend/reword after), then diff against the branch's
fork point:

```bash
git add package-lock.json jobs/package-lock.json
git commit -m "chore(deps): ..."
BASE_SHA=$(git merge-base main HEAD) HEAD_SHA=HEAD node scripts/check-dependency-publishers.mjs
```

If anything fails, do not commit that lockfile as-is. Either drop back to a narrower scoped
update (step 3) that excludes the flagged package, or investigate and wait out the cooldown.
A failure here after a blanket `npm update` is the signal to redo the update scoped to only
the packages you actually meant to touch.

### 3. Run the update

**Prefer a scoped update over a blanket one.** `npm update` with no arguments walks the
*entire* dependency tree, not just the packages `npm outdated` listed — it will happily bump
dozens of transitive packages (babel, bundler internals, native binaries, etc.) that never
appeared in step 1's output and were never individually cooldown/publisher-checked. That is
what makes the CI check in step 2 necessary in the first place, and a large blanket diff makes
its output hard to triage. Scope the update to the packages you actually intend to change:

```bash
npm update <pkg1> <pkg2> ...          # root — only the packages from `npm outdated`
cd jobs && npm update <pkg1> <pkg2> ... # jobs/
```

A scoped update still pulls in that package's own transitive deps (e.g. `@typescript-eslint/*`
internals), which is expected — the point is to avoid touching unrelated subtrees like a
bundler or CSS-processing chain that happen to share the top-level `node_modules`.

Install scripts are skipped because of `.npmrc`. This is intentional and safe — see the next step for packages that legitimately need their scripts.

### 4. Re-audit install scripts

Confirm the set of packages that ship install scripts has not changed:

```bash
grep -l '"postinstall"\|"preinstall"\|"install":' \
  node_modules/*/package.json node_modules/@*/*/package.json 2>/dev/null

grep -l '"postinstall"\|"preinstall"\|"install":' \
  jobs/node_modules/*/package.json jobs/node_modules/@*/*/package.json 2>/dev/null
```

The current known-good list is:

| Package | Location | Script | Safe to skip? |
|---------|----------|--------|---------------|
| `protobufjs` | root + jobs/ | `postinstall` (benign version-warning log) | Yes — skip |
| `esbuild` | jobs/ only | `postinstall` (downloads platform binary) | **No — must rebuild (step 5)** |

If grep returns a package not in this table, **stop**. Inspect the script (`cat node_modules/<pkg>/...`) before doing anything else. If the script is legitimate, add it to this table. If it's suspicious, remove the package and report it.

### 5. Re-enable scripts only for packages that need them

This is how you safely update packages that require their install script. Do not flip `ignore-scripts` off — invoke each legitimate one explicitly:

```bash
cd jobs && npm rebuild esbuild
```

`npm rebuild <pkg>` runs **only** that package's install scripts (`preinstall` / `install` / `postinstall`) plus its native compile step if applicable, in isolation. It does not touch the rest of the tree. Any new package added to the table above gets its own `npm rebuild` line.

`protobufjs` does not need a rebuild — its postinstall only prints a warning.

### 6. Verify nothing regressed

```bash
npm test                    # root — runs vitest
```

The `jobs/` project has no test suite; smoke-test by running the job entry script if changes touched it.

### 7. Review the lockfile diff before committing

```bash
git diff package-lock.json jobs/package-lock.json | less
```

Look for:
- Unexpected new transitive packages (search "node_modules/<name>" entries)
- Changes to `resolved:` URLs that do not point at `registry.npmjs.org`
- New `scripts` blocks (lockfile records script hashes for some packages)
- Integrity hash changes on packages whose version did not change — strong signal of a republish

If the diff looks clean, commit. If anything looks off, revert with `git checkout -- package-lock.json jobs/package-lock.json` and investigate.

## Major version bumps

`npm update` will not pull a major bump. To take one:

1. Read the package's changelog / migration guide first.
2. `npm install <pkg>@<exact-version> --save-exact` (in the right project directory).
3. Run the same audit (step 4), cooldown check (step 2), rebuild (step 5 if applicable), and tests (step 6).
4. Commit the `package.json` and lockfile change in one commit with a message that names the bump.

Known pending major bumps as of 2026-05-16:
- `ejs` 3 → 5 (root)
- `esbuild` 0.25 → 0.28 (jobs/) — note 0.x semver: every minor is potentially breaking

## Adding a new dependency

Same flow, with one addition: before installing, check whether the new package brings install scripts. The quickest way is to look at its `package.json` on the npm registry web UI or:

```bash
npm view <pkg>@<version> scripts
```

If it has install scripts, decide whether they are necessary. If yes, add it to the table in step 4 and document the `npm rebuild` line. If no, the existing `.npmrc` posture handles it automatically.

## What to do if you suspect a compromise

1. Do not run `npm install` again.
2. `git checkout -- package-lock.json jobs/package-lock.json` to revert.
3. `rm -rf node_modules jobs/node_modules` to drop any code that may have been written to disk.
4. Check `~/.npmrc` and shell history for any unexpected entries.
5. Rotate any credentials that were exposed to the shell environment during the install (npm tokens, gcloud, GitHub).
6. Reinstall from the reverted lockfile with `npm ci --ignore-scripts`, then go through the workflow above.

## Why this works

- `ignore-scripts=true` neutralizes the primary execution vector. A malicious `postinstall` cannot run.
- The 72-hour cooldown means a compromised release usually gets yanked before you ever pull it.
- The grep-based audit gives you a **tripwire**: any new install script in the tree is a deliberate event that requires a decision, not an automatic execution.
- `npm rebuild <pkg>` re-enables scripts surgically, so legitimate native builds and binary fetches still work without lowering the global guard.
