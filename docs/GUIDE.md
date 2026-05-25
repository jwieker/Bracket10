---
tags: [guide, entry-point]
updated: 2026-05-09
---

# AI Code Assistant Guidance

This is the entry point for AI assistants. Read this file first, then load only the additional files relevant to your task.

## When to Read Which File

| Task | Read |
|------|------|
| Any task (always read this first) | `docs/GUIDE.md` |
| Frontend UI, styling, CSS, animations | `docs/design/DESIGN.md` |
| Deployment, env vars, Cloud Run, PWA | `docs/architecture/deployment.md` |
| Utilities, errors, Logger | `docs/architecture/utilities.md` |
| Caching, cache invalidation, TTLs | `docs/architecture/caching.md` |
| Security, CSP, rate limiting, admin auth | `docs/architecture/security.md` |
| Firestore schema, data structure | `docs/architecture/database.md` |
| API routes, admin console, email, analytics | `docs/features/routes.md` |
| Max possible points, Playground, game undo | `docs/features/complex-features.md` |
| ESPN polling runtime (pollService, espnTeamMap) | `docs/features/espn-polling.md` |
| Email workflow (Gmail MCP drafts) | `docs/features/email-workflow.md` |
| Code style, new API pattern, performance | `docs/private/development/contributing.md` |
| Writing or debugging tests | `docs/private/development/testing.md` |
| npm updates, dependency bumps, supply-chain safety | `docs/development/npm-updates.md` |
| ESPN year setup or historical data import | `docs/tournament/espn-setup.md` |
| ESPN API response structure, import strategy | `docs/tournament/espn-api-notes.md` |
| ESPN tournament dates by year | `docs/tournament/espn-tournament-dates.md` |
| Domain terminology (Bracket, Entry, Group…) | `docs/domain.md` |
| Known technical debt and code inconsistencies | `docs/private/development/tech-debt.md` |

## Overview

This project is a bracket application for the NCAA basketball tournament. It allows users to create and join groups, make their picks, and track their scores. Built with Node.js, Express, and Google Cloud Firestore.

## Getting Started

See the top-level [`README.md`](../README.md) for the full setup guide (local boot vs. self-host paths). The TL;DR is:

```bash
npm install
cp .env.example .env       # then fill in SESSION_SECRET at minimum
npm run dev                # auto-reload on file changes
```

## Project Structure

*   `/src` - Application source code
    *   `/config` - Configuration files (app.js, firestore.js, ESPN maps)
    *   `/controllers` - HTTP request handlers
    *   `/middleware` - Express middleware (admin auth, error handling)
    *   `/repositories` - Database access layer (Firestore)
    *   `/routes` - API route definitions
    *   `/services` - Business logic
    *   `/utils` - Utility functions (caching, errors, logger, controller helpers)
*   `/views` - EJS templates for server-side rendering
    *   `/partials` - Reusable template components (header, nav, bracket, scripts)
*   `/public` - Static assets (CSS, client JS, PWA manifests, icons)
    *   `/js` - Client-side JavaScript
    *   `/admin` - Admin-specific static assets
*   `/tests` - Vitest test suite (unit, integration, live E2E)
*   `/data/seed` - NDJSON fixtures for integration tests and local-emulator seeding (committed to git)
*   `/scripts` - One-off data migration and maintenance utilities
*   `/ai` - AI assistant guidance (this folder)
    *   `/architecture` - Deployment, utilities, caching, security
    *   `/design` - Design system spec, light/dark component galleries (HTML)
    *   `/development` - Contributing guide, testing strategy, tooling
    *   `/features` - Routes, complex features, ESPN polling, email
    *   `/tournament` - ESPN setup, API notes, tournament dates

## Architecture

This application follows the MVC (Model-View-Controller) pattern:

*   **Routes**: Define API endpoints and handle request routing
*   **Controllers**: Process HTTP requests and responses
*   **Services**: Contain core business logic
*   **Repositories**: Handle database interactions

**Layer precision matters:** When describing code flows, always be precise about which layer a function belongs to. Controller, service, and repository layers have distinct responsibilities and often have similarly named functions. See `docs/private/development/contributing.md` for the layer guidance section.

## Key Technologies and Libraries

*   **Backend:** Node.js, Express
*   **Database:** Google Cloud Firestore
*   **Frontend:** EJS, Bootstrap, jQuery
*   **Testing:** Vitest
*   **Caching:** Local in-memory TTL cache in `src/utils/cacheUtils.js` (single-instance — caches fragment if Cloud Run scales to multiple instances)
*   **Security:** `src/middleware/securityHeaders.js` (inline CSP + Referrer-Policy), `src/middleware/rateLimit.js` (fixed-window route throttling), `express-session` (admin session auth), Google OAuth state validation, `year:entryId` public-entry verification, generic production internal-error responses

## Security Assumptions

Future work should preserve these invariants. Full detail in [`docs/architecture/security.md`](./architecture/security.md).

- Google OAuth starts at `/auth/google/start`, stores a random `oauthState` in the server-side session, validates it on `/auth/google/callback` before token exchange, and verifies the returned ID token with `audience: getGoogleClientId()` so cross-client tokens cannot pass.
- `/my-entry/*` verification is keyed by exact `year:entryId`; public updates must re-read the stored entry and must not trust hidden form fields for groups, email, payment, or email-sent metadata.
- Production JSON responses for `DatabaseError` and `ServiceError` are generic. Detailed internals stay in server logs.
