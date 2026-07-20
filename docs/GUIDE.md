---
tags: [guide, entry-point]
updated: 2026-05-29
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
| Code style, contributing guidelines | `CONTRIBUTING.md` |
| Dependency updates | `docs/development/npm-updates.md` |
| ESPN setup, historical imports | `docs/tournament/espn-setup.md` |
| ESPN API structure, import strategy | `docs/tournament/espn-api-notes.md` |
| ESPN tournament dates by year | `docs/tournament/espn-tournament-dates.md` |
| Domain terminology | `docs/domain.md` |

## Overview

NCAA basketball bracket pool app. Users create groups, make picks, and track scores. Built with Node.js, Express, and Google Cloud Firestore.

## Getting Started

```bash
npm install
cp .env.example .env       # Set SESSION_SECRET at minimum
npm run dev                # Local dev server with hot reload
```

## Directory Structure

* `/src` - Application source
    * `/config` - App config (Firestore, ESPN maps)
    * `/controllers` - HTTP request handlers
    * `/middleware` - Express middleware (auth, rate limits, security)
    * `/repositories` - Database access layer (Firestore)
    * `/routes` - API routes
    * `/services` - Business logic
    * `/utils` - Utility functions (caching, errors, logging)
* `/views` - Server-rendered EJS templates
    * `/partials` - Shared UI fragments
* `/public` - Static assets (CSS, client JS, PWA icons)
* `/tests` - Vitest test suite
* `/scripts` - Maintenance and data migration scripts

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
* **Security**: Inline CSP, Referrer-Policy, fixed-window rate limits, Google OAuth state checks

## AI Tool Configuration

Each AI coding assistant reads its own config file for project-specific instructions. Actively used tools have their config **committed** so cloud and ephemeral AI environments get instructions automatically:

| Tool | Config file | Status |
|------|-------------|--------|
| Claude / Claude Code | `CLAUDE.md` | committed |
| Gemini / Gemini CLI | `gemini.md` | committed |
| Jules | `.julesrules` | committed |
| Cursor | `.cursorrules` | gitignored |
| Windsurf | `.windsurfrules` | gitignored |
| Cline | `.clinerules` | gitignored |

If you're adding a new AI assistant, create its config file, point it here (`docs/GUIDE.md`) as the first thing to read, and commit it. See `CONTRIBUTING.md` for the cost contract and project conventions.

## Security Assumptions

Future work must preserve these. Full detail: [`docs/architecture/security.md`](./architecture/security.md).

- OAuth stores `oauthState` in session. `/auth/google/callback` validates state before token exchange. ID token verified with `audience: getGoogleClientId()`.
- `/my-entry/*` uses `year:entryId` session keys. Updates re-read the stored entry. Server-owned fields (groups, email, payment, email-sent) are never taken from form input.
- Production `DatabaseError` and `ServiceError` responses are generic. Details stay in server logs.
