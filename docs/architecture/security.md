---
tags: [architecture, security, csp]
updated: 2026-06-09
---

# Security Architecture

## Security Headers (`src/middleware/securityHeaders.js`)

Helmet was removed in favour of a custom `securityHeaders` middleware that sets headers explicitly. Headers applied to every response:

| Header | Value |
|---|---|
| `Content-Security-Policy` | Enforcing strict nonce policy — per-request `script-src 'self' 'nonce-…' 'strict-dynamic' https:`, no `'unsafe-inline'`. Built from `BASE_DIRECTIVES` + per-request `script-src` in `securityHeaders.js` |
| `Content-Security-Policy-Report-Only` | Mirrors the enforcing policy + report routing — a regression-telemetry channel. Suppressed by `CSP_REPORT_ONLY=off` |
| `Reporting-Endpoints` | `csp-endpoint="<origin>/csp-report"` — absolute URL (`APP_HOST`, else the request origin); only when report-only is enabled |
| `Referrer-Policy` | `same-origin` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |

CSP is defined in `securityHeaders.js`: the shared directives live in `BASE_DIRECTIVES`, and the `script-src` is composed **per request** with the live nonce (`buildScriptSrc` / `buildEnforcedHeader`). Key rules:

- **`script-src` is `'self' 'nonce-<per-request>' 'strict-dynamic' https:`** — **no `'unsafe-inline'`**. Every first-party `<script>` (inline and `src=`) must carry `nonce="<%= cspNonce %>"` or it will be blocked. `'strict-dynamic'` lets the nonce'd loaders pull the CDN deps, so script CDN hosts no longer need allowlisting.
- **`script-src-attr` is not set** — inline event-handler attributes (`onclick="..."`, `onchange="..."`, etc.) are **blocked** and must not be used.
- **Rule:** Never add inline `on*=` handlers. Either use the shared delegated dispatcher in `views/partials/scripts.ejs` (add a `data-act="fn"` / `data-action-change="fn"` / `data-filter-dropdown` / `data-confirm-submit="fn"` / `data-clear-placeholder` hook that maps to a global function in a nonce'd page script), or wire `addEventListener` directly inside a nonce'd `<script>` block. See `views/playground.ejs` (page-scoped `data-action` delegation) for the canonical example.
  - Note: the shared dispatcher uses `data-act` (not `data-action`) precisely so it doesn't collide with `playground.ejs`'s own page-scoped `data-action` listeners.
- `style-src`, `img-src`, `font-src` are similarly scoped (`BASE_DIRECTIVES`). If adding new CDN resources, add them to the relevant directive in `securityHeaders.js`.

**CSP blocks inline event handler attributes.** The enforcing policy blocks `oninput="fn()"`, `onchange="fn()"`, and similar inline event attributes. Wire up listeners inside a nonce'd `<script>` block instead:

```html
<!-- ❌ Blocked by CSP — inline handler attribute -->
<input oninput="filterResults()">

<!-- ✅ Works — listener added in a nonce'd script block -->
<script nonce="<%= cspNonce %>">
  document.getElementById('myInput').addEventListener('input', filterResults);
  filterResults(); // DOM is already ready, call directly
</script>
```

### Nonce-based CSP — enforcing (H1, shipped)

The enforcing `Content-Security-Policy` is the strict nonce policy (no
`'unsafe-inline'`); a mirrored report-only header runs alongside purely as a
regression-telemetry channel (`docs/private/red-team-hardening.md` § H1).

- `securityHeaders` generates a per-request nonce (`randomBytes(16)`) and exposes
  it as `res.locals.cspNonce`. **Every first-party `<script>` tag (inline and
  `src=`) in the views carries `nonce="<%= cspNonce %>"`** — a new inline script
  or `<script src>` without the nonce is **blocked** by the enforcing policy.
- The enforcing `script-src` is `'self' 'nonce-…' 'strict-dynamic' https:` — no
  `'unsafe-inline'`. `'strict-dynamic'` lets the nonce'd loaders pull the CDN
  deps; `https:` is a fallback for browsers that ignore `'strict-dynamic'`.
- `script-src-attr` is **dropped entirely** — all inline `on*=` event-handler
  attributes were migrated to delegated listeners (the shared dispatcher in
  `views/partials/scripts.ejs`), so inline handler attributes are no longer
  allowed and are blocked if reintroduced.
- The report-only header mirrors the enforcing policy, so a future un-nonced
  inline script/handler still gets reported via `POST /csp-report` even though
  it's also blocked — an early-warning signal for regressions.
- **Violation sink:** `POST /csp-report` (`server.js`) logs each violation as a
  single compact line to **stdout** (Cloud Run logs) — no Firestore, no third
  party. It is rate-limited (30/min) and silenced entirely by the
  `CSP_REPORT_ONLY=off` kill switch (cost contract).
- **The sink's fields are attacker-controlled** (the endpoint is necessarily
  unauthenticated), so `logCspReport` sanitizes every field before logging:
  control characters (U+0000–U+001F, U+007F) are replaced with spaces — an
  embedded `\n` can't forge a second log line (CWE-117) — fields are capped at
  256 chars, and at most 10 report entries are processed per request. The body
  parser accepts only `application/csp-report` and `application/reports+json`
  (not generic `application/json`). Locked by tests in
  `tests/securityHeaders.test.js`. (Security audit 2026-06-09, finding 3.)

## Rate Limiting

Two backends, both in `src/middleware/rateLimit.js`:

- **In-memory** (`rateLimit`) — small fixed-window middleware, counters in a per-process `Map`. Used as a coarse per-instance DoS guard on high-volume public reads where exactness doesn't matter. Effective cap is `max × instanceCount` (each Cloud Run instance counts independently); acceptable for these routes, not for security-sensitive ones.
- **Firestore-backed** (`firestoreRateLimit` → `incrementWindow`) — a fixed-window counter incremented in a Firestore transaction, so the cap is **global** across all instances. Used only on low-volume, security-sensitive routes so total Firestore ops stay inside the free tier (M1 from the red-team review).

Limiters in use:
- **Login limiter** (Firestore, keyed `login:<ip>`): 15 / 10 min on `GET /auth/google/start`, `GET /auth/google/user/start`, and the shared `GET /auth/google/callback` (`src/routes/pointsRoutes.js`).
- **Verify limiter** (Firestore, keyed `verify:<entryId>`): 10 / 10 min on `POST /my-entry/verify`, layered after the public limiter. Keying on `entryId` blocks email brute-force even when the attacker rotates IPs. Tradeoff: someone who knows an `entryId` can exhaust that entry's budget, locking the owner out for up to 10 min — low impact, and the price of IP-rotation-proof protection.
- **Public limiter** (in-memory): 30 / min on the public POST routes in `src/routes/viewRoutes.js`.

Both backends key by `req.ip` (with `req.socket.remoteAddress` as the only fallback in the in-memory limiter). Do not manually parse `x-forwarded-for`; Express's `req.ip` already applies the configured `trust proxy` policy.

The Firestore limiter **fails open** on store errors (a Firestore outage must not lock users out of login) and has a kill switch: set `RATE_LIMIT_FIRESTORE_DISABLED=1` to bypass the store. Once a window has hit its cap, `incrementWindow` returns a blocking count **without writing** — so a flood against one key can't exceed Firestore's ~1 write/s/doc soft limit and trigger contention failures that (via fail-open) would otherwise let blocked requests through. This also bounds writes to `max` per window per key, protecting the cost contract. Counter docs live in the `rateLimits` collection; windows reset in place so the collection is bounded by distinct keys, and an optional Firestore TTL policy on the `expireAt` field reaps abandoned keys for free.

`trust proxy` is set to `1` in `server.js`, which is required when running behind Cloud Run / proxy infrastructure. If the app is deployed behind a different proxy chain, update `trust proxy` in `server.js` rather than changing the limiter to read raw forwarding headers.

Expired client entries are overwritten when a client returns. As a guard against unbounded growth from one-off IPs, the limiter sweeps expired entries whenever the client map reaches 1,000 entries and a new client arrives.

## Safe JSON Embedding in `<script>` Tags

When embedding server data in a `<script>` tag via EJS, use `safeJson` to prevent `</script>` from breaking out of the script context:

```ejs
<% const safeJson = obj => JSON.stringify(obj).replace(/</g, '\\u003c'); %>
<script>
  const DATA = {
    entries: <%- safeJson(entries) %>,
  };
</script>
```

This pattern is applied in all views that embed server data: `registration.ejs`, `editEntry.ejs`, `myEditEntry.ejs`, `results.ejs`, and `playground.ejs`. **Never use the backtick template literal pattern** (`JSON.parse(\`<%- JSON.stringify(x) %>\`)`) — it allows `${...}` injection if user-controlled data contains backticks or `${`.

## CSV Export Formula-Injection Defense

The public `GET /getFullGridCSV` export includes attacker-controlled strings (entrant `person`/`teamName`, set at unauthenticated registration). RFC 4180 quoting alone does **not** neutralize spreadsheet formulas — `"=HYPERLINK(...)"` still executes when the file is opened in Excel/Sheets/LibreOffice. `toCSVRow` (`src/utils/csvUtils.js`, used by `getFullGridCSV` in `src/controllers/resultsController.js`) therefore prefixes any cell beginning with `=`, `+`, `-`, `@`, TAB, or CR with a single quote (the OWASP CSV-injection defense) *before* quote-wrapping. Keep this neutralization if the serializer is ever rewritten — quoting and formula-neutralization are independent layers. (Security audit 2026-06-09, finding 1.)

Known tradeoff: the leading-`-` rule means a negative numeric cell would be emitted as text (`'-2`). This is harmless today because every numeric export column (Rank, Points, counts, pick indexes) is non-negative — a regression test in `tests/resultsController.test.js` pins this. If a signed column is ever added, exempt actual numbers from neutralization (e.g. only neutralize string-typed cells) rather than dropping `-` from the character set.

## Safe Dynamic DOM Construction

Client-side scripts that render server/user data into the DOM **must build nodes programmatically**, never by concatenating an HTML string into `innerHTML`. String-building with `innerHTML` is an XSS sink even when each value is run through a hand-rolled `esc()` helper — one missed interpolation re-opens the hole.

```javascript
// ❌ XSS sink — any unescaped value injects markup
el.innerHTML = `<p><strong>Name:</strong> ${team.name}</p>`;

// ✅ Safe — text can never be parsed as markup
const p = document.createElement('p');
const strong = document.createElement('strong');
strong.textContent = 'Name: ';
p.appendChild(strong);
p.appendChild(document.createTextNode(team.name ?? ''));
el.appendChild(p);
```

Rules:

- Use `createElement` + `textContent` / `createTextNode` + `appendChild`. `textContent` escapes natively, so the `esc()` helper is unnecessary in these paths.
- For status/message regions that toggle between states, a small helper keeps callers safe by construction — e.g. `setStatus(el, text, type)` in `newTourneyComplete.ejs` clears the node, builds a `<span class="text-${type}">`, and assigns `textContent`. Guard it with `if (!el) return;` so a missing target element can't throw.
- For attributes that take user data, set them via property assignment and URL-encode where the value is a URL component — e.g. `a.href = '/viewTeam?teamId=' + encodeURIComponent(String(team.sid))`. Do **not** use `esc()` for URL params.
- To move already-rendered, trusted DOM (not strings) into a new container, clone nodes — `Array.from(cell.childNodes).forEach(n => span.appendChild(n.cloneNode(true)))` — rather than reading `cell.innerHTML` back out into a string.
- Use `??` (not `||`) for optional fields like `mascot` / `nameNick` so a legitimately empty string isn't replaced.
- For large, mostly-static repeated structures, define the markup once in a `<template>` and clone it per item (`tpl.content.firstElementChild.cloneNode(true)`), then fill values via `textContent` / `dataset` / `classList` and replace the container's contents with `replaceChildren(...nodes)`. Build `<select>` choices as `<option>` / `<optgroup>` elements, not option HTML strings.

Reference implementations: `views/adminTeams.ejs`, `views/adminEntries.ejs`, `views/results.ejs`, `views/updater.ejs`, `views/newTourneyComplete.ejs`, `views/playground.ejs`, `views/newtournement.ejs`, `views/adminTournament.ejs`, `views/newTourneyGames.ejs`, `views/editTeam.ejs`.

## Admin Route Protection (`src/middleware/adminMiddleware.js`)

Admin routes are protected by **session-based authentication** via `requireSiteAdmin`. The login flow:

> The session flag is `req.session.siteAdmin` (not `isAdmin`) and the middleware is `requireSiteAdmin` (not `requireAdminSession`). The names were chosen so that a future `requireGroupAdmin` tier cannot accidentally widen to site-wide access.


1. User visits `GET /updates` → renders `adminLogin.ejs`.
2. User clicks sign-in → `GET /auth/google/start`. Sets `req.session.rememberMe` (if `?remember=1`), generates `req.session.oauthState`, saves session, redirects to Google via `getAuthUrl(oauthState)` in `src/config/auth.js`.
3. Google redirects to `GET /auth/google/callback` with an authorization code and `state`.
4. `googleAuthCallback` consumes `req.session.oauthState` and `req.session.oauthRole`. Rejects if `state` is missing or mismatched. The **role lives in the session, not in the `state` string** (so it can't be tampered with) and defaults to `"admin"` when absent, leaving the legacy flow unchanged. The callback is shared with the participant flow (below) and branches on this role.
5. Exchanges code for tokens via `getToken()`. Verifies ID token with `audience: getGoogleClientId()` (**required** — without it, tokens from other OAuth clients would pass). For the admin role: checks email against `ADMIN_EMAILS`, calls `req.session.regenerate()`, sets `req.session.siteAdmin = true`.
6. Extends `cookie.maxAge` to 30 days if `rememberMe` was set; otherwise 8-hour session.
7. All subsequent admin requests gated by `requireSiteAdmin`, which checks `req.session?.siteAdmin`.
8. `POST /admin/logout` destroys the session and redirects to `/updates`.

**OAuth `state`** is for login CSRF only. Keep remember-me in the server-side session — not in the OAuth state value.

`startGoogleAuth` reassigns `rememberMe` on every start to prevent a stale session carrying a previous value.

## CSRF Protection for Admin POSTs (`src/middleware/csrf.js`)

Every state-changing admin POST (all 26 `requireSiteAdmin` POST routes, including `POST /admin/cloud/deploy` and the destructive deletes) is guarded by a **per-session synchronizer token** — hand-rolled, no dependency, in the same spirit as `securityHeaders.js` replacing helmet. This breaks the stored-XSS → CSRF-less-deploy chain at its terminal sink (security audit 2026-06-09, finding 4): even a same-origin forged request (which `sameSite: 'lax'` and `httpOnly` do nothing against) is rejected without the token.

- **`attachCsrfToken`** (mounted globally in `server.js`, after the session middleware): mints a 32-byte base64url token into `req.session.csrfToken` and exposes it as `res.locals.csrfToken` — **only when the session already carries `siteAdmin`**. Anonymous traffic never triggers a session write, so `saveUninitialized: false` and the $0 cost contract stay intact.
- **`verifyCsrf`**: mounted **after** `requireSiteAdmin` on each admin POST (unauthenticated callers still get the 401). Accepts the token from the `x-csrf-token` header (AJAX) or the `_csrf` body field (HTML forms); constant-time comparison; 403 JSON on mismatch.
- **Templates:** admin forms carry `<input type="hidden" name="_csrf" value="<%= csrfToken %>">`; admin AJAX `fetch` calls send `'x-csrf-token': '<%= csrfToken %>'`. When adding a new admin POST route or form, add both the `verifyCsrf` guard and the token — `tests/routes.test.js` fails if an admin POST is registered without `verifyCsrf`.
- `POST /admin/logout` is deliberately not CSRF-guarded (forcing a logout is equivalent to session expiry; a 403 there could strand a stale tab).
- `GET /admin/cloud/budget` is the one admin GET with a side effect (a cache-bypassing read of the free Billing Budgets API via `getBudgetStatus({ force: true })`). It stays a GET deliberately: it changes no app state, the API is free, and `sameSite: lax` means a cross-site sub-resource fetch won't carry the session — the worst forgeable case is a tricked top-level navigation that refreshes a cache. If it ever gains a costlier or state-changing side effect, convert it to POST + `verifyCsrf`.
- Tests: `tests/csrf.test.js` (token minting, admin-only attachment, header/body acceptance, rejection paths) and the route-composition assertions in `tests/routes.test.js`.

Sessions persist in Firestore (`express-sessions` collection), surviving Cloud Run restarts. Each session doc carries an `expireAt` Firestore `Timestamp` (mirroring the `rateLimits` pattern) so a TTL policy can reap expired sessions — see the one-time setup in [deployment.md](./deployment.md#firestore-one-time-setup); the store also opportunistically deletes expired docs on read, so the collection stays bounded even if the TTL policy is missing (security audit 2026-06-09, finding 2). **Do not reintroduce `requireAdminReferrer`** — `Referer` is not a security control.

Admin access: comma-separated `ADMIN_EMAILS` env var. See `src/config/auth.js`.

## Participant Authentication — "My Brackets" (`requireUser`)

Participants can sign in with **any** Google account to view all their entries (matched by email, across every year) and edit current-year entries during the window. This is **separate from and strictly weaker than admin auth** — it grants no admin access.

1. The landing page (`views/partials/userSignIn.ejs`, included by `index.ejs`) shows a "Sign in with Google" button → `GET /auth/google/user/start`.
2. `startUserGoogleAuth` mirrors `startGoogleAuth` but tags the session with `req.session.oauthRole = "user"` before redirecting to Google. It reuses the **same OAuth client, scopes, and registered redirect URI** — no Google Cloud Console change is needed (the reason the callback branches on the session role instead of using a second callback path).
3. The shared `GET /auth/google/callback` verifies `state` + ID token (audience-pinned, as above), then on the `"user"` branch: accepts any verified email (no `ADMIN_EMAILS` check), calls `req.session.regenerate()`, sets **only** `req.session.userEmail = email.toLowerCase()` (never `siteAdmin`), sets `cookie.maxAge` to 14 days (2 weeks), and redirects to `/my-brackets`.
4. `requireUser` (`src/middleware/adminMiddleware.js`) gates `/my-brackets*` on `req.session.userEmail` and **never** inspects `siteAdmin` — the two identities are independent session fields, so neither implies the other.
5. `POST /user/logout` destroys the session and redirects to `/` (POST-only, so it can't be triggered cross-site).

**Ownership model (IDOR-proof):** the dashboard only ever queries `getEntriesByEmail(userEmail)` — the user never supplies an entry ID to *list*. For edit/update, `userEntryView` / `userEntryUpdate` re-fetch the entry by ID and reject with **403** unless `storedEntry.email.toLowerCase() === req.session.userEmail.toLowerCase()`. Editing is additionally gated on `isRegistrationOpen()` **and** the entry being the current tournament year (`canEditYear`), so past-year entries are read-only. As with `myEntryUpdate`, server-owned fields (`email`, `groups`, payment/email metadata) are preserved from the stored entry rather than trusted from the form.

**Highlighting "your" rows on the public results page:** `gameView` highlights the signed-in user's own entries by matching email **on the server** — using `req.session.userEmail` (participant) or, failing that, `req.session.adminEmail` (admin console) — via `getEntryIdsForUserInGroup` → `getEntriesByEmail`, filtered to the viewed group + year, and passing only the resulting **entry-ID list** to `results.ejs`. No email is ever placed in this public page's HTML, and the cached, user-agnostic `buildGameViewData` is left untouched — the per-user data is the separate ID list.

## Session Lifecycle

`req.session.regenerate()` **must be called at every privilege transition** — before setting `siteAdmin`, `verifiedEntries`, or any other session flag that grants access. This prevents session fixation: an attacker who pre-sets a victim's session cookie cannot reuse it after the victim authenticates.

Pattern (used in `myEntryVerify` and both branches of `googleAuthCallback` — admin and participant):
1. Capture any data you want to carry across (e.g. `rememberMe`).
2. `await regenerateSession(req)` — destroys old session, creates new ID.
3. Set the privilege flags on `req.session`.
4. `await saveSession(req)` — persists the new session before the redirect.

`req.session.regenerate()` and `req.session.save()` are callback-based; use the `regenerateSession(req)` / `saveSession(req)` promise helpers in `controllerUtils.js` rather than hand-rolling `new Promise()` wrappers.

**Google session clearing:** Administrators can clear all active Google Sign-in sessions via the admin console (`POST /clearGoogleSessions`, protected by `requireSiteAdmin`). This deletes all session documents from the `express-sessions` Firestore collection that have `userEmail` or `adminEmail` fields set, logging those users out immediately. Under standard operations, memory cache flushes (generic cache clear) do **not** affect active sessions.

## Public Entry Edit Authorization

The `/my-entry/*` flow uses a lightweight ownership check for public self-service edits:

1. `POST /my-entry/verify` requires `entryId`, `year`, and email.
2. The submitted email is compared case-insensitively against the stored entry email.
3. On success, `req.session.regenerate()` is called, then `req.session.verifiedEntries["${year}:${entryId}"] = true` is saved.
4. `GET /my-entry/edit` and `POST /my-entry/update` require that exact `year:entryId` session key.
5. `myEntryUpdate` re-reads the stored entry before writing and preserves server-owned fields (`email`, `groups`, `hasPaid`, `paymentNote`, `payByCheck`, `emailSent`) instead of trusting hidden form values.

This prevents a session verified for one tournament year from updating the same numeric entry ID in another year, and prevents public users from changing group membership or payment/email metadata through forged form fields.

## Error Response Policy

`ValidationError` responses can include user-correctable details.

`DatabaseError` and `ServiceError` responses are environment-sensitive:

- **Production:** generic message only.
- **Non-production:** `message`, `operation`, and `service` details included.
- **All environments:** full detail logged via `Logger.error`.

## Outstanding Security Items

- _(none currently — see `docs/private/red-team-hardening.md` for the residual-risk roadmap, e.g. the CSP enforce-flip H1 and the `sameSite: 'strict'` admin-cookie split.)_

## Fixed

- **CSRF tokens on admin POSTs (FIXED — 2026-06-10, was Fix #10):** Per-session synchronizer token (`src/middleware/csrf.js`) enforced on all 26 admin POST routes; 19 forms carry the `_csrf` hidden input and 19 admin AJAX calls send the `x-csrf-token` header. Admin-session-only minting keeps anonymous traffic write-free. See § CSRF Protection for Admin POSTs and audit finding 4.
- **`/csp-report` log injection (FIXED — 2026-06-10):** `logCspReport` strips control characters, caps field length at 256, and bounds entries at 10 per request; the route's body parser no longer accepts generic `application/json`. See § Content Security Policy and audit finding 3.
- **`innerHTML` string-building migration completed across remaining views (FIXED — 2026-05-30):** The six views that still string-built `innerHTML` with a hand-rolled `esc()` were converted to DOM construction (`createElement` / `textContent` / `dataset` / `<template>` clone + `replaceChildren`): `playground.ejs` (public results simulator — game cards, simulated picks, standings), `newtournement.ejs` (find-team modal), `newTourneyComplete.ejs` (First Four rows + `<option>`/`<optgroup>` builders), `adminTournament.ejs` (ESPN games list), `newTourneyGames.ejs` (add-team status), and `editTeam.ejs` (conference-history rows). No reachable injection existed (every value was escaped and attributes were double-quoted), but the fragile pattern — where correctness depended on never missing an interpolation — is now eliminated. All per-view `esc` helpers and `playground`'s `escHtml` (which silently omitted single-quote escaping) were removed. Client-side DOM test coverage (jsdom) was deferred as a follow-up. Static-string-only `innerHTML` placeholders (no interpolated data) remain in `adminEntries.ejs` and `updater.ejs` — not injection sinks. See § Safe Dynamic DOM Construction.
- **XSS via `innerHTML` status messages in `newTourneyComplete.ejs` (FIXED — 2026-05-29):** The admin "new tournament" view built add-team and create-tournament status messages by interpolating team data and error/exception text into HTML strings assigned to `statusEl.innerHTML`. A crafted team name, API error, or exception `message` could execute script in the admin's session. All status writes now route through a `setStatus(el, text, type)` helper that builds a `<span>` via `textContent` (guarded with `if (!el) return;`). See "Safe Dynamic DOM Construction" above.
- **Stored/reflected XSS via `innerHTML` string-building (FIXED — 2026-05-28):** `adminTeams.ejs`, `adminEntries.ejs`, `results.ejs`, and `updater.ejs` built result rows by interpolating team/entry data into HTML strings assigned to `innerHTML`. A crafted team name or entry field could execute script in an admin's session (or a user's, on the results detail expander). All four now build DOM via `createElement`/`textContent`/`appendChild`, `encodeURIComponent` for URL params, and `cloneNode` for moving trusted nodes. See "Safe Dynamic DOM Construction" above.
- **Internal error field disclosure narrowed (FIXED — 2026-05-17):** `operation` and `service` fields now require `DEBUG_ERRORS=1`. Default is generic-only in all environments. Full detail still logged. See `tests/middleware.test.js`.
- **Pending-confirmation save-after-DB race closed (FIXED — 2026-05-17):** `entryVerify` now awaits `session.save` before `createNewEntry`. Previously, a save failure after a DB insert caused duplicate entries on retry. See `tests/registrationController.test.js`.
- **CSP / security-header regression coverage (FIXED — 2026-05-17):** 9 tests in `tests/securityHeaders.test.js` assert CSP directives, HSTS max-age, and all five required headers. CSP regressions (wildcards, missing hosts, weakened `frame-src`) now fail loudly.
- **OAuth audience pin (FIXED — 2026-05-17):** `verifyIdToken` now passes `audience: getGoogleClientId()`. Without it, tokens from other OAuth clients would pass. See `tests/pointsController.test.js`.
- **OAuth login CSRF (FIXED — 2026-05-09):** `startGoogleAuth` generates a random session-backed `state`. Validated and consumed in `googleAuthCallback` before token exchange.
- **Public entry ownership hardening (FIXED — 2026-05-09):** `/my-entry/*` uses `year:entryId` session keys. `myEntryUpdate` re-reads the stored entry and preserves server-owned fields.
- **Production internal error disclosure (FIXED — 2026-05-09):** `DatabaseError` and `ServiceError` responses are generic in production. Full details stay in server logs.
- **XSS (FIXED):** Backtick template literal injection in `registration.ejs`, `editEntry.ejs`, `myEditEntry.ejs`, `results.ejs` replaced with `safeJson` pattern.
- **Cache key info disclosure (FIXED):** `cacheDebugMiddleware` only sets headers when `req.session?.siteAdmin` and `NODE_ENV !== 'production'`.
- **Session cookie sameSite (FIXED):** `sameSite: 'lax'` added to session cookie in `server.js`.
- **Session fixation (FIXED — 2026-05-02):** `req.session.regenerate()` added to `myEntryVerify` and `googleAuthCallback` before setting privilege flags. See Session Lifecycle above.
- **PII in logs (FIXED — 2026-05-02):** `controllerUtils.js` redacts sensitive fields (`email`, `name`, `picks`, `entryId`, etc.) in start-logs. Values appear as `[redacted]` in Cloud Logging.
- **Entry confirm URL data leak (FIXED — 2026-05-02):** `/entryConfirm` no longer accepts picks via query params. `entryVerify` stores a 10-min session token and redirects to `/entryConfirm?token=<nonce>`. Invalid/expired tokens render `confirmExpired.ejs` (404).

