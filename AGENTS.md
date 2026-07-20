# AGENTS.md

Canonical guidance for AI coding agents (and humans) working in this repo. Tool-specific
files (`CLAUDE.md`, `.cursorrules`, `.windsurfrules`, `.clinerules`, `.julesrules`,
`gemini.md`) point here so there is a single source of truth.

**Start every task by reading [`docs/GUIDE.md`](./docs/GUIDE.md)** — it maps your task to the
right architecture docs under `docs/`.

## What this repo is

**Bracket 10** is a server-rendered March Madness bracket pool. A Node/Express app
(`server.js` + `src/`) renders EJS views and stores everything in Google Cloud Firestore.
A separate ESPN polling job (`jobs/espn-poll.js`) runs as a scheduled Cloud Run Job to pull
live scores. Both deployments share the same `src/` code and the same Firestore database.

## Repo map

| Path                                                            | What's there                                                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `server.js`                                                     | Express app entry point                                                                                                   |
| `src/`                                                          | App code, layered: `routes/` → `controllers/` → `services/` → `repositories/`, plus `config/`, `middleware/`, `utils/`    |
| `jobs/`                                                         | ESPN polling Cloud Run Job (`espn-poll.js`); shares `src/services/pollService.js`                                         |
| `views/`                                                        | EJS server-rendered templates                                                                                             |
| `public/`                                                       | Static assets, client JS, PWA service workers                                                                             |
| `data/`                                                         | Seed data (tournament fixtures, conferences, schools)                                                                     |
| `scripts/`                                                      | Migration, seeding, backup, and the public-sync tooling                                                                   |
| `tests/`                                                        | Vitest suite (unit, integration, live e2e)                                                                                |
| `docs/`                                                         | Architecture/design/development/features docs; start at `docs/GUIDE.md`, component map in `docs/architecture/overview.md` |
| `Dockerfile`, `Dockerfile.poll`, `cloudbuild*.yaml`, `Procfile` | Deploy config (web app + poll job, GCP Cloud Run)                                                                         |

## Conventions

- **ESM** JavaScript, Node 20.6+, Express 5, EJS templates. No build step for the web app.
- **Firestore is the single source of truth.** Only `src/repositories/*` access it directly —
  routes/controllers/services must go through repositories.
- **Tests: Vitest.** Run `npm test` (config in `vitest.config.js`) before and after changes.
- **Lint before finishing.** Run `npm run lint` (config in `eslint.config.js`) and fix errors
  before considering a task done — CI blocks on lint errors. `npm run lint:fix` handles the
  mechanical ones. This is the enforced half of "match existing style".
- **Use the `Logger`, not `console.log`** — tests assert on structured JSON log output.
- **Cost contract: keep the project ~$0/month.** Any change adding recurring spend needs a
  kill switch or explicit funding — read `CONTRIBUTING.md` § "Cost contract" first.

## General coding behavior

These bias toward caution over speed; for trivial tasks, use judgment.

- **Think before coding.** State assumptions; if multiple interpretations exist, surface them
  rather than picking silently. If something is unclear, ask.
- **Simplicity first.** Minimum code that solves the problem — no speculative abstractions,
  flexibility, or error handling for impossible scenarios.
- **Surgical changes.** Touch only what the task requires. Match existing style. Don't refactor
  unrelated code or delete pre-existing dead code; mention it instead.
- **Goal-driven execution.** Turn tasks into verifiable goals ("add validation" → "write tests
  for invalid inputs, then make them pass") and loop until tests pass.
- **Act decisively.** With a likely cause and a clear fix, make the change — don't re-litigate
  the same evidence.
- **Update the docs.** If you discover new patterns or make architectural changes, update the
  relevant file under `docs/`. Skip updates for minor changes.
- **Never leak internals.** Don't expose stack traces, Firestore paths, or user IDs in API
  responses or rendered views — log them server-side only.

## Reviewing & maintaining PRs

This repo receives a steady stream of auto-generated PRs, so reviewing and fixing existing
PRs is a routine task. Beyond the normal review lens:

- **Verify locally; don't wait on CI.** CI status often reads `pending`. Check out the PR head
  in a throwaway git worktree (symlink the repo's `node_modules` into it), then run the
  affected tests plus `npm test`. This is faster and more trustworthy than the checks tab.
- **Template changes need a render-level check.** Controller tests mock `res.render`, so they
  do **not** catch EJS compile errors. When a PR touches a `.ejs` view, render the real
  template. Watch especially for an undefined local in a view shared by an authenticated and an
  anonymous flow (e.g. `myEditEntry.ejs` serves both `/my-brackets` and the public `/my-entry`)
  — EJS throws on undefined locals, so a missing `csrfToken`/`userEmail` will 500 the page.
- **Watch for overlapping PRs.** Auto-generated PRs frequently touch the same file or region.
  When several do, call out the overlap, name which one is the superset, and warn about
  merge-order conflicts before approving.
- **Resolving conflicts / updating onto main is a maintenance action — only do it when asked.**
  Merge `origin/main` into the PR branch; do **not** rebase + force-push a branch you don't own
  (bot- or contributor-authored). Rebase + force-push is only for your own `claude/*` branches.
  After resolving, run the full `npm test` (not just the conflicted file — semantic conflicts
  pass locally and break elsewhere) and confirm the PR is no longer marked conflicting.
- **Branch scope.** Net-new work originating in a session goes on your assigned `claude/*`
  branch. Review/maintenance fixes go on the target PR's own branch, with the user's permission.
- **Reply on the review thread, not just the commit.** When you apply a finding from an inline
  review comment, reply on that specific thread (not a general PR comment) confirming what
  changed and the commit SHA — the diff alone doesn't tell the reviewer their comment was seen.
  If you decline a suggestion or resolve it differently than proposed (e.g. scoping a fix down
  instead of extending it), reply with the reasoning instead of silently diverging. Findings
  that depend on each other (a nit that only applies if a should-fix goes one way) need their
  own reply once the dependency resolves, even if the code itself didn't change for that thread.
