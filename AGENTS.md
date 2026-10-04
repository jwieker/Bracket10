# AGENTS.md

Canonical guidance for AI coding agents (and humans) working in this repo. Tool-specific
files (`CLAUDE.md`, `.cursorrules`, `.windsurfrules`, `.clinerules`, `.julesrules`,
`GEMINI.md`, `.github/copilot-instructions.md`) point here so there is a single source of truth.

**Start every task by reading [`docs/GUIDE.md`](./docs/GUIDE.md)** — it maps your task to the
right architecture docs under `docs/`.

## Session setup (all agents)

1. Read `docs/GUIDE.md`, then run `node scripts/agent-context.js` from the repo root. It prints
   optional checkout-specific context (none in a public clone is normal). Without shell tools,
   continue with the shared docs and say so.
2. Check `git status --short --branch` before editing. Preserve existing user changes. Use
   the assigned branch; otherwise create a descriptive branch with your tool's normal prefix
   (for example `codex/`, `claude/`, or `gemini/`).
   **Never commit or push changes directly to `main`.** Always use a task branch and open
   a PR against `main` (or update the existing PR), including for small fixes and docs-only
   changes. A request to commit or push does not waive the PR requirement.
3. Use Node 24 to match CI's major version (exact pin in `.github/workflows/test.yml`).
   If dependencies are missing or the lockfile changed, run `npm ci --ignore-scripts`.
   `npm test` needs no `.env`, GCP credentials, or running Firestore emulator. Leave
   `LIVE_E2E` unset for the default suite; read `tests/README.md` before choosing live tests.
4. Run `npm test` before changes, then the three CI gates below after changes. Report
   checks that could not run and why. There is no web build step.

Hooks, plugins, skills, and scheduled loops are optional integrations, not prerequisites.
**Tool availability is not permission** to publish, merge, deploy, or send messages; follow the
user's authorized scope. Record durable project knowledge in the repo's docs, not chat history.

## What this repo is

**Bracket 10** is a server-rendered March Madness bracket pool. A Node/Express app
(`server.js` + `src/`) renders EJS views and stores everything in Google Cloud Firestore.
A separate ESPN polling job (`jobs/espn-poll.js`) runs as a scheduled Cloud Run Job to pull
live scores. Both deployments share the same `src/` code and the same Firestore database.

## Repo map

| Path                                                            | What's there                                                                                                                     |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `server.js`                                                     | Express app entry point                                                                                                          |
| `src/`                                                          | App code, layered: `routes/` → `controllers/` → `services/` → `repositories/`, plus `config/`, `middleware/`, `types/`, `utils/` |
| `jobs/`                                                         | ESPN polling Cloud Run Job (`espn-poll.js`); shares `src/services/pollService.js`                                                |
| `views/`                                                        | EJS server-rendered templates                                                                                                    |
| `public/`                                                       | Static assets, client JS, PWA service workers                                                                                    |
| `data/`                                                         | Seed data (tournament fixtures, conferences, schools)                                                                            |
| `scripts/`                                                      | Migration, seeding, backup, and the public-sync tooling                                                                          |
| `tests/`                                                        | Vitest suite (unit, integration, live e2e)                                                                                       |
| `docs/`                                                         | Architecture/design/development/features docs; start at `docs/GUIDE.md`, component map in `docs/architecture/overview.md`        |
| `Dockerfile`, `Dockerfile.poll`, `cloudbuild*.yaml`, `Procfile` | Deploy config (web app + poll job, GCP Cloud Run)                                                                                |

## Conventions

- **ESM** JavaScript, Node 20.6+, Express 5, EJS templates. No build step for the web app.
- **Firestore is the single source of truth, and only `src/repositories/*` touch it** —
  routes/controllers/services go through repositories. The classes live in
  `src/repositories/hierarchicalRepository.js`, consumed as singletons from
  `src/repositories/index.js`; a class name doesn't always predict its entity (method map in
  `docs/architecture/database.md`). The one other Firestore handle in the served app is
  `src/utils/startupChecks.js` (`firestoreSessionStore.js` holds none — it delegates to
  `SessionRepository`). **A second handle-holder is a violation, not a style note**; `scripts/`
  is outside the rule.
- **Tests: Vitest.** Run `npm test` (config in `vitest.config.js`) before and after changes.
  Test tiers (pure / integration / live e2e) and which one a new test belongs in: `tests/README.md`.
- **Run the exact CI sequence before any push.** `.github/workflows/test.yml` runs three gates,
  and **all three block**:

  ```bash
  npm run lint          # eslint.config.js — errors block; no-console warnings don't
  npm run format:check  # Prettier (.prettierrc.json) — fails on any unformatted file
  npm test              # Vitest
  ```

  `npm run lint:fix` and `npm run format` fix the mechanical failures. **Skipping
  `format:check` is the most common way a change here goes red.** EJS templates in `views/` are
  exempt from Prettier (it mangles `<% %>`); match the surrounding style there.

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
  relevant file under `docs/`. Skip updates for minor changes. When you edit a doc with YAML
  front matter, **bump its `updated:` date in the same commit**.
- **Correct in place; don't append.** Fix the sentence that's wrong. Never leave a stale claim
  standing above a newer paragraph that contradicts it.
- **Never leak internals.** Don't expose stack traces, Firestore paths, or user IDs in API
  responses or rendered views — log them server-side only. Verbose error details require
  explicit `DEBUG_ERRORS` and must never be exposed in production.

## Output budgets

Keep responses concise and lead with the outcome. These budgets govern artifacts written
to GitHub and Slack by any agent, when the user has authorized those actions.

Automated loops follow the same table; a ceiling may be narrowed here, never raised.

Every artifact below is a **ceiling, not a target**. Come in under it.

| Artifact              | Ceiling                                      | Lead with                        |
| --------------------- | -------------------------------------------- | -------------------------------- |
| PR body               | 200 words across all sections                | What broke and what the fix does |
| PR review body        | 150 words + the inline comments              | The verdict                      |
| Inline review comment | 3 sentences + an optional `suggestion` block | `file:line` and the consequence  |
| Review-thread reply   | 2 sentences                                  | Changed it, or why not           |
| PR/issue comment      | 150 words                                    | The outcome or the ASK           |
| Slack summary         | 5 lines                                      | The ASK                          |
| Commit message        | 72-char subject + 3 body lines               | The _why_                        |

Rules that apply to all of them:

- **The diff is the record.** Never walk a reviewer through changes they can read. Name what
  isn't visible in the diff: the reason, the trade-off, the thing you couldn't test.
- **Drop empty sections rather than filling them.** A required heading with nothing real under
  it ("Trade-offs: none", "Risk: low") costs a reader a line and tells them nothing. Omit it.
- **No praise, no throat-clearing.** Skip "Great catch", "This looks solid overall", and any
  restatement of what the PR does before saying what's wrong with it.
- **One artifact per event.** Don't post a comment that a thread reply covers, or a Slack
  message that repeats a PR comment verbatim — link to it.
- **Never post to say nothing changed — except a scheduled loop's heartbeat.** A no-op
  event-driven round stays silent. A scheduled loop posts every firing, empty result included,
  in one line — otherwise a loop that never fired looks the same as one that found nothing.

## Reviewing & maintaining PRs

**Review checklist** (omit headings with no findings):

- **Security**: Auth bypasses, CSP violations, missing rate limits, session handling, OAuth state, XSS/injection — threat model in [docs/architecture/security.md](./docs/architecture/security.md).
- **Cost**: New Firestore reads/writes, Cloud Run scaling changes, third-party API calls, missing kill switches — see [CONTRIBUTING.md](./CONTRIBUTING.md#cost-contract).
- **Architecture**: Layer violations (routes → controllers → services → repositories), Firestore access outside repositories, business logic in the wrong layer.
- **Correctness**: Logic bugs, off-by-one errors, missing null/undefined checks at system boundaries (user input, external API responses).
- **Tests**: Missing coverage for changed logic; existing suite in `./tests`.
- **Style**: Deviations from [CONTRIBUTING.md](./CONTRIBUTING.md#code-style).

Reviewing or fixing an existing PR — auto-generated PRs, overlapping PRs, coverage-only PRs,
performance claims, conflict resolution, thread replies — follow
[`docs/development/reviewing-prs.md`](./docs/development/reviewing-prs.md). Two rules from it
apply everywhere: never rebase or force-push a branch you don't own (merge `origin/main` into it
instead, and only when asked), and reply on the review thread when you apply or decline a finding.
