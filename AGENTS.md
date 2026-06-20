# AGENTS.md

Canonical guidance for AI coding agents (and humans) working in this repo. Tool-specific
files (`claude.md`, `.cursorrules`, `.windsurfrules`, `.clinerules`, `.julesrules`,
`gemini.md`) point here so there is a single source of truth.

**Start every task by reading [`docs/GUIDE.md`](./docs/GUIDE.md)** — it maps your task to the
right architecture docs under `docs/`.

## What this repo is

**Bracket 10** is a server-rendered March Madness bracket pool. A Node/Express app
(`server.js` + `src/`) renders EJS views and stores everything in Google Cloud Firestore.
A separate ESPN polling job (`jobs/espn-poll.js`) runs as a scheduled Cloud Run Job to pull
live scores. Both deployments share the same `src/` code and the same Firestore database.

## Repo map

| Path | What's there |
|------|--------------|
| `server.js` | Express app entry point |
| `src/` | App code, layered: `routes/` → `controllers/` → `services/` → `repositories/`, plus `config/`, `middleware/`, `utils/` |
| `jobs/` | ESPN polling Cloud Run Job (`espn-poll.js`); shares `src/services/pollService.js` |
| `views/` | EJS server-rendered templates |
| `public/` | Static assets, client JS, PWA service workers |
| `data/` | Seed data (tournament fixtures, conferences, schools) |
| `scripts/` | Migration, seeding, backup, and the public-sync tooling |
| `tests/` | Vitest suite (unit, integration, live e2e) |
| `docs/` | Architecture/design/development/features docs; start at `docs/GUIDE.md`, component map in `docs/architecture/overview.md` |
| `Dockerfile`, `Dockerfile.poll`, `cloudbuild*.yaml`, `Procfile` | Deploy config (web app + poll job, GCP Cloud Run) |

## Conventions

- **ESM** JavaScript, Node 20.6+, Express 5, EJS templates. No build step for the web app.
- **Firestore is the single source of truth.** Only `src/repositories/*` access it directly —
  routes/controllers/services must go through repositories.
- **Tests: Vitest.** Run `npm test` (config in `vitest.config.js`) before and after changes.
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
