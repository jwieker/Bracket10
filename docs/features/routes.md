---
tags: [features, routes, api]
updated: 2026-06-09
---

# API Routes Overview

## Game Routes (`/src/routes/gameRoutes.js`)

*   `POST /updateWinner`: Updates the winner of a game (also releases any `manualHold`).
*   `POST /undoGame`: Undoes a game update. Clears the winner AND sets `manualHold: true` so the ESPN poll cannot immediately re-apply the result from its feed. For First Four games, also repicks affected entries back to the combined option.
*   `POST /releaseGameHold`: Clears the `manualHold` set by an undo, letting the poll resolve the game again on its next run. Body: `gameID`, `year`. Triggered by the "Release Hold" button on `/admin/tournament`.
*   `POST /admin/trigger-espn-poll`: Admin UI dry-run endpoint (protected by `requireSiteAdmin`). Same matching logic but **does not write to DB** — returns a preview. Called by the "Poll ESPN" button on the admin console.

## Index Routes (`/src/routes/indexRoutes.js`)

*   `GET /`: Renders the home page.

### Entry Page Architecture

The home page (`views/index.ejs`) is a single template with server-side conditionals. The controller (`src/controllers/indexController.js`) computes a `state` string:

| `state` value | When set | What renders |
|---|---|---|
| `'comingsoon'` | Before bracket launch date | "Coming soon" message + view-previous-brackets form |
| `'registration'` | Bracket live, tournament not started | "Create your bracket" form (POST `/newEntry`) |
| `'tournament'` | Tournament underway | "View your bracket" form (POST `/gameView`) |
| `'test'` | `NODE_ENV` is `test` or `development` | All three sections visible for manual testing |

**Updating tournament dates:** `bracketLaunchDate` and `tourneyStartDate` are defined once in `src/config/app.js`. Do not hardcode these dates in controllers. Also exported: `isRegistrationOpen()` — returns `true` during the registration window (or always in `development`/`test`).

**Participant sign-in entry point:** the home page also includes `views/partials/userSignIn.ejs` in every state, which renders a "Sign in with Google" button (→ `GET /auth/google/user/start`) — or a "My Brackets" link when `req.session.userEmail` is set (passed through by `indexController`). See § "My Brackets — Participant Sign-In" under View Routes.

## Results Page Architecture & Mobile Layout

The results page (`views/results.ejs`) handles both a traditional desktop table and a responsive mobile card list (hidden/shown via CSS media queries in `public/table-styles.css`).

*   **Responsive Layout Matching:** Hybrid approach — `<table>` rows on large screens (`>768px`) and `<div class="mob-entry-card">` on small screens (`<=768px`).
*   **Dual Tap Targets (Mobile):** Mobile card header split into two flexbox areas:
    *   **Left Side (Rank, Name, Team):** Triggers the detailed picks modal summary.
    *   **Right Side (Points, Chevron):** Triggers a Bootstrap `collapse` animation to reveal the round-by-round point breakdown (`mob-round-detail`).
*   **Ranking & Trophy Logic:** A gold trophy renders next to the participant's name *only* after the tournament concludes. The completion boolean checks if the rank 1 entry's `totalPoints === possPoints` directly in EJS (`isTourneyOver`) and in the client-side sorting script (`finalReached`).
*   **Advanced Teams Logic:** The `"X adv"` metric displays *only* while a phase is actively in progress. Completely hidden between rounds by the backend forcing `teamsAdvanced = 0` until the next round tips off.
*   **Tablesort Synchronization:** The desktop table uses `Tablesort`. An `afterSort` event listener synchronously re-orders `.mobile-card-list` DOM elements to match the sorted table rows' `data-group-id` attribute.

## Email Routes (`/src/routes/viewRoutes.js` — admin-only)

*   `GET /admin/unsent-emails?year=<year>`: Returns all entries where `emailSent` is not `true`. Protected by `requireSiteAdmin`.
*   `POST /admin/mark-emails-sent`: Accepts `{ year, entryIds[] }` and batch-updates entries with `emailSent: true`. Protected by `requireSiteAdmin`.

## Admin Routes (`/src/routes/adminRoutes.js`)

*   `GET /admin`: Redirects to `GET /admin/tournament`.
*   `GET /admin/tournament`: Game results page. Landing page after login.
*   `GET /admin/entries`: Entry management (find, view, unpaid, bracket emails, new group).
*   `GET /admin/teams`: Team management plus link to Conferences.
*   `GET /admin/system`: System tools (recalculate points, clear cache, change year).
*   `GET /admin/cloud`: Cloud/ops dashboard — GCP budget summary, deep links to the GCP console (Firestore, Cloud Run, Cloud Build, logs, Secret Manager, IAM, etc.), and a "Deploy to Production" button.
*   `GET /admin/cloud/budget`: JSON endpoint that force-refreshes the in-process budget cache. Used by the dashboard's "Refresh" button.
*   `POST /admin/cloud/deploy`: Triggers the existing Cloud Build trigger to rebuild the image and roll out a new Cloud Run revision. Returns `{ ok, buildId, branch, logUrl }`.

All admin GET routes protected by `requireSiteAdmin`. `POST /admin/cloud/deploy` is also `requireSiteAdmin`. `POST /admin/logout` destroys session and redirects to `/updates`.

**Cloud dashboard implementation:** view `views/adminCloud.ejs`, controller actions `adminCloudPage` / `adminCloudBudgetRefresh` / `adminCloudDeploy` in `src/controllers/adminController.js`, GCP integration in `src/services/cloudService.js`. See `docs/architecture/deployment.md` § "Admin Cloud Dashboard" for the production setup runbook (env vars, IAM grants, optional BigQuery billing export for live spend).

**Controllers:** `src/controllers/adminController.js` handles all `GET /admin/*` routes. `POST /changeYear` uses `changeYear` from `adminController.js`.

## Points Routes (`/src/routes/pointsRoutes.js`)

*   `GET /updates`: Renders the admin login page (Google Sign-In button/form).
*   `GET /auth/google/start`: Starts **admin** Google OAuth. Tags `req.session.oauthRole = "admin"`, generates and saves a random session-backed `oauthState`, preserves remember-me preference, then redirects to Google with `state`.
*   `GET /auth/google/user/start`: Starts **participant** Google OAuth ("My Brackets"). Mirrors the admin start but tags `req.session.oauthRole = "user"`. Reuses the same OAuth client and registered redirect URI. Login-rate-limited.
*   `GET /auth/google/callback`: **Shared** Google OAuth callback. Consumes and validates session-backed `state` before token exchange, verifies the ID token (audience-pinned), then **branches on `req.session.oauthRole`** (defaults to `admin`): admin → email allowlist check → `siteAdmin` session → `/admin/tournament`; user → any verified email → `userEmail` session (never `siteAdmin`) → `/my-brackets`. Both branches regenerate the session first. See `docs/architecture/security.md`.
*   `POST /user/logout`: Participant sign-out. `requireUser`-guarded; destroys the session and redirects to `/`.
*   `POST /updateTotalPoints`: Updates total points for all groups.
*   `POST /possibleRank`: Gets possible ranking for current year.
*   `POST /changeYear`: Admin-only; redirects to `GET /admin/tournament?year=<year>`.

## View Routes (`/src/routes/viewRoutes.js`)

*   `POST /getFullGrid`, `POST /gameView`, `POST /newEntry`, `POST /entryVerify`
*   `POST /calculateMaxPoints`: Calculates maximum possible points for a given set of picks.
*   `GET /viewEntry`, `POST /entryUpdate`, `GET /find-entry`
*   `POST /newGroup`, `GET /viewTeam`, `POST /updateTeam`, `GET /find-team`
*   `GET /addTeamPage`, `POST /addTeam`, `POST /deleteTeam`, `POST /deleteEntry`
*   `GET /entryConfirm?token=<nonce>` — reads the confirmation payload from `req.session.pendingConfirmations[token]`, deletes the entry (single-use), and renders `confirm.ejs`. Returns 404 / renders `confirmExpired.ejs` if the token is missing, unknown, or older than 10 minutes. The token is set by `entryVerify` after a successful entry creation — picks and personal data are never passed in query params.
*   `GET /my-entry` — renders the email-gate lookup form (`myEntryLookup.ejs`). Accepts optional `?entryId=&year=` query params to pre-fill the Entry ID field (used when redirecting from `myEntryView`).
*   `POST /my-entry/verify` — ownership verification step. Checks submitted `email` case-insensitively against the entry's stored email; calls `req.session.regenerate()` then sets `req.session.verifiedEntries["${year}:${entryId}"] = true` and `req.session.save()` before redirecting to `/my-entry/edit`. Redirects back with `?error=invalid` on failure (same message whether entryId is unknown or email is wrong, to avoid enumeration). Rate-limited by `publicLimiter`.
*   `GET /my-entry/edit` — renders `myEditEntry.ejs`. Requires `req.session.verifiedEntries["${year}:${entryId}"]`; redirects to `/my-entry` if absent.
*   `POST /my-entry/update` — updates the entry. Requires exact `year:entryId` session verification and `isRegistrationOpen()`; redirects to `/my-entry` if either fails. Re-reads the stored entry before writing and preserves server-owned fields (`email`, `groups`, payment metadata, email-sent metadata) instead of trusting hidden form fields.
*   `GET /playground`: Ephemeral "what-if" simulation. Accepts `?group=<name>&year=<year>`. No DB writes — all simulation runs client-side.

### My Brackets — Participant Sign-In (`requireUser`)

Google-authenticated alternative to the Entry-ID lookup above; coexists with it. Identity is `req.session.userEmail` (set by the participant OAuth flow — see Points Routes). All three routes use `publicLimiter` + `requireUser`.

*   `GET /my-brackets` — dashboard listing every entry whose `email` matches the signed-in Google email, **across all tournament years**, grouped by year with groups/points (`views/myBrackets.ejs`). Built by `getEntriesForUser` → `gameRepository.getEntriesByEmail` (mirrors the cross-year `getAllYearsForGroup` pattern). Current-year entries show an **Edit** button during the window; others show a read-only **View bracket** link (POST `/gameView`).
*   `GET /my-brackets/edit?entryId=&year=` — renders the shared `myEditEntry.ejs` editor (form posts to `/my-brackets/update`). Authorized by **email ownership** (`storedEntry.email === session userEmail`, case-insensitive) instead of the `/my-entry` verification token; 403s on mismatch. Gated by `isRegistrationOpen()` **and** current-year (`canEditYear`).
*   `POST /my-brackets/update` — same ownership + window/year gate, then reuses the exact pick-parsing/write of `myEntryUpdate` (preserving server-owned fields). 403 on mismatch, redirect to `/my-brackets` if the entry is gone.

## Tourney Routes (`/src/routes/tourneyRoutes.js` — admin-only)

All routes guarded by `requireSiteAdmin`.

*   `POST /createTournament`: Creates a new tournament bracket, including optional First Four games. Single-page creation flow.
*   `POST /setupNewTourney`: Renders the single-page creation form (`newTourneyComplete.ejs`).
*   `POST /admin/poll-espn-scheduled`: Fetches *scheduled* ESPN games for given date(s) to auto-populate the creation form. Read-only helper — does not poll scores and is unrelated to the Cloud Run poll job.
*   `POST /regionVerify` → `POST /gamesVerify`: Legacy two-step creation flow (no First Four support).
*   `POST /tournamentGames` / `POST /editTournament`: Both render the edit-tournament page (`editTourneyGames.ejs`) via the same `viewTournament` controller — one is a legacy alias.
*   `POST /tournamentGamesUpdate`: Applies bracket edits; school changes are propagated into entry picks via `updateEntrywithNewSchools`.
*   `POST /deleteTournament`: Deletes a tournament year.

See `docs/architecture/request-flows.md` for the end-to-end creation/edit traces.

## Conference Routes (`/src/routes/conferenceRoutes.js`)

*   `GET /conferences`, `GET /viewConference`, `POST /updateConference`
*   `GET /addConferencePage`, `POST /addConference`

## Admin Destructive Action Confirmation

Destructive admin forms must include a `data-confirm` attribute. `public/js/admin/confirmDestructive.js` intercepts `submit` events on any `form[data-confirm]` and calls `window.confirm(msg)` before allowing the POST.

- **Reversible actions** (e.g. `updateWinner`, which has `undoGame`): use plain wording — `"Set winner for game X?"`
- **Irreversible actions** (`deleteEntry`, `deleteTeam`): use stronger language — `"PERMANENTLY delete...? This cannot be undone."`
- Include `confirmDestructive.js` at the bottom of any admin page that has destructive forms.

For admin tournament's Submit/Undo buttons (which use JS `fetch()` rather than form POST), `window.confirm()` is called directly inside the click handler.

## Admin Console Architecture

| Page | URL | Views file |
|---|---|---|
| Game Results | `/admin/tournament` | `views/adminTournament.ejs` |
| Entries | `/admin/entries` | `views/adminEntries.ejs` |
| Teams & Conferences | `/admin/teams` | `views/adminTeams.ejs` |
| System | `/admin/system` | `views/adminSystem.ejs` |
| Conferences | `/conferences` | `views/manageConferences.ejs` |

All section pages share `views/partials/admin-nav.ejs`.

## Analytics

Google Analytics 4 (GA4) is integrated via the shared user-facing header partial.

- **Tag location:** `views/partials/header.ejs` (top of file)
- **Measurement ID:** read from the `GA_MEASUREMENT_ID` env var and exposed to templates as `app.locals.gaMeasurementId`. Leave the env var unset to omit the GA snippet entirely (the default for forks).
- **Coverage:** All user-facing pages (admin header intentionally excludes the tag).

GA4 auto-tracks page views, sessions, and form interactions. No custom `gtag('event', ...)` calls exist yet.

## Data Maintenance Scripts

The `scripts/` directory contains one-off and recurring data maintenance utilities. These connect directly to Firestore using the same project ID as production.

## Related Files

- `docs/features/espn-polling.md` — ESPN polling runtime architecture
- `docs/features/email-workflow.md` — Email draft workflow via Gmail MCP
- `docs/features/complex-features.md` — Max possible points, Playground, Game Advancement
- `docs/architecture/security.md` — Admin route protection, rate limiting, CSP
