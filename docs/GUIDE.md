---
tags: [guide, entry-point]
updated: 2026-09-24
---

# AI Code Assistant Guidance

Entry point for AI assistants. Read this first, then load files relevant to your task.

## Tasks and Documentation

| Task | Read |
|------|------|
| All tasks (always read first) | `docs/GUIDE.md` |
| UI, styling, CSS, animations | `docs/design/DESIGN.md` |
| Deployment, env vars, Cloud Run, PWA | `docs/architecture/deployment.md` |
| Utilities, errors, Logger | `docs/architecture/utilities.md` |
| Caching, invalidation, TTLs | `docs/architecture/caching.md` |
| Security, CSP, rate limiting, auth | `docs/architecture/security.md` |
| Firestore schema, data structure | `docs/architecture/database.md` |
| Big-picture architecture, component map | `docs/architecture/overview.md` |
| Routes, admin console, email, analytics | `docs/features/routes.md` |
| End-to-end request flows (user/admin/poll), access tiers | `docs/architecture/request-flows.md` |
| Points, Playground, game undo | `docs/features/complex-features.md` |
| ESPN polling runtime | `docs/features/espn-polling.md` |
| Email workflow (Gmail MCP) | `docs/features/email-workflow.md` |
| AI assistant setup, portability, instruction maintenance | `docs/development/ai-onboarding.md` |
| Code style, contributing guidelines | `CONTRIBUTING.md` |
| Reviewing or fixing an existing PR | `docs/development/reviewing-prs.md` |
| Writing a test — which tier it belongs in, data-safety rules | `tests/README.md` |
| Dependency updates | `docs/development/npm-updates.md` |
| ESPN setup, historical imports | `docs/tournament/espn-setup.md` |
| ESPN API structure, import strategy | `docs/tournament/espn-api-notes.md` |
| ESPN tournament dates by year | `docs/tournament/espn-tournament-dates.md` |
| Domain terminology | `docs/domain.md` |

## Overview

NCAA basketball bracket pool app. Users create groups, make picks, and track scores. Built with Node.js, Express, and Google Cloud Firestore.

## Getting Started

For coding and the default test suite (Node 24, no service credentials required):

```bash
node scripts/agent-context.js
npm ci --ignore-scripts
npm test                   # Leave LIVE_E2E unset
```

To run the app, follow the emulator or self-hosting setup in `README.md`.

## Directory Structure

* `/src` - Application source
    * `/config` - App config (Firestore, ESPN maps)
    * `/controllers` - HTTP request handlers
    * `/middleware` - Express middleware (auth, rate limits, security)
    * `/repositories` - Database access layer (Firestore) — all classes in `hierarchicalRepository.js`, consumed as singletons from `index.js`
    * `/routes` - API routes
    * `/services` - Business logic
    * `/types` - Shared JSDoc typedefs
    * `/utils` - Utility functions (caching, errors, logging)
* `/views` - Server-rendered EJS templates
    * `/partials` - Shared UI fragments
* `/public` - Static assets (CSS, client JS, PWA icons)
* `/jobs` - ESPN polling Cloud Run Job (`espn-poll.js`); shares `src/services/pollService.js`
* `/data/seed` - Prod-shaped fixtures for tests and emulator seeding
* `/tests` - Vitest test suite (see `tests/README.md` for the three tiers)
* `/scripts` - Maintenance, data migration, and public-sync tooling

## Architecture & Layers

Standard MVC pattern:
* **Routes**: Map endpoints to handlers.
* **Controllers**: Parse inputs, handle responses, wrap handlers.
* **Services**: Core business logic, workflows, and transaction checks.
* **Repositories**: Firestore CRUD and atomic queries.

**Layer Precision**: Be exact about layer names. Do not refer to controller functions as service or repository methods.

## Key Stack

* **Backend**: Node.js, Express, Firestore
* **Frontend**: EJS, Bootstrap, jQuery, local TTL caching
* **Security**: Per-request nonce CSP (`strict-dynamic`, no `unsafe-inline` for scripts, `base-uri 'self'`), Referrer-Policy, fixed-window rate limits (in-memory + Firestore-backed global), Google OAuth state checks

## AI Tool Configuration

Shared instructions live in [`AGENTS.md`](../AGENTS.md). All entry files below are committed
and designed to route hosts to that guidance. Claude and Gemini use import directives;
the other adapters direct the assistant to read the canonical file. Fresh Claude, Gemini,
and Copilot sessions have not been verified; see the validation limits in
[`AI onboarding`](./development/ai-onboarding.md#validation-status).

| Tool | Entry file |
|------|------------|
| Codex (OpenAI), other AGENTS.md-aware agents | `AGENTS.md` |
| Claude Code | `CLAUDE.md` |
| Gemini CLI | `GEMINI.md` (uppercase, including on Linux) |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Jules | `AGENTS.md`, `.julesrules` compatibility pointer |
| Cursor | `AGENTS.md`, `.cursorrules` compatibility pointer |
| Windsurf | `AGENTS.md`, `.windsurfrules` compatibility pointer |
| Cline | `.clinerules` |

Follow the session setup in `AGENTS.md`, including `node scripts/agent-context.js` for any
additional checkout context. Coding and the default test suite need only Node and npm;
service access is configured separately when a task needs it.

See [`docs/development/ai-onboarding.md`](./development/ai-onboarding.md) for supported
entry points, setup commands, and how to keep new tools from creating another rules copy.

## Security Assumptions

Future work must preserve these. Full detail: [`docs/architecture/security.md`](./architecture/security.md).

- OAuth stores `oauthState` in session. `/auth/google/callback` validates state before token exchange. ID token verified with `audience: getGoogleClientId()`.
- `/my-entry/*` uses `year:entryId` session keys. Updates re-read the stored entry. Server-owned fields (groups, email, payment, email-sent) are never taken from form input.
- Production `ServiceError` responses are generic. Details stay in server logs. The internal `service` field requires `DEBUG_ERRORS`.
- CSP `script-src` is nonce-only per request; `base-uri` is pinned to `'self'` so an HTML injection can't rewrite root-relative script URLs to an attacker origin.
- Request logs omit query strings and allow only validated numeric body metadata; new fields are excluded by default. Request-boundary error logs omit raw messages and error properties — see [`docs/architecture/utilities.md`](./architecture/utilities.md).
