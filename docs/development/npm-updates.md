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
npm view <pkg>@<version> time.modified _npmUser
```

If a target version is fresher than 72h, wait. Compromised releases are usually yanked within a day or two; the cooldown is the cheapest defense against installing one. If the publisher is not the expected maintainer / org, stop and investigate.

### 3. Run the update

```bash
npm update                  # root
cd jobs && npm update       # jobs/
```

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
