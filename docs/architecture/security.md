---
tags: [architecture, security, csp]
updated: 2026-05-09
---

# Security Architecture

## Security Headers (`src/middleware/securityHeaders.js`)

Helmet was removed in favour of a custom `securityHeaders` middleware that sets headers explicitly. Headers applied to every response:

| Header | Value |
|---|---|
| `Content-Security-Policy` | See CSP_DIRECTIVES in the file |
| `Referrer-Policy` | `same-origin` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |

CSP is defined in `CSP_DIRECTIVES` at the top of `securityHeaders.js`. Key rules:

- **`script-src` includes `'unsafe-inline'`** — required for inline `<script>` blocks in EJS templates.
- **`script-src-attr` includes `'unsafe-inline'`** — required for attribute-based handlers (`onclick`, `onchange`, etc.) on the creation page.
- **Rule:** Any click handler on HTML generated via `innerHTML` must use **event delegation** (`container.addEventListener('click', fn)`) instead of inline `onclick="..."` attributes. See `views/playground.ejs` for the canonical example.
- `style-src`, `img-src`, `font-src` are similarly scoped. If adding new CDN resources, add them to the relevant directive in `securityHeaders.js`.

**CSP blocks inline event handler attributes.** The CSP blocks `oninput="fn()"`, `onchange="fn()"`, and similar inline event attributes on HTML elements you add. Wire up listeners inside a `<script>` block at the bottom of the EJS template instead:

```html
<!-- ❌ Blocked by CSP — attribute silently ignored -->
<input oninput="filterResults()">

<!-- ✅ Works — listener added in script block -->
<script>
  document.getElementById('myInput').addEventListener('input', filterResults);
  filterResults(); // DOM is already ready, call directly
</script>
```

## Rate Limiting (`src/middleware/rateLimit.js`)

Two limiters:
- **Login limiter:** 15 requests / 10 min on `GET /auth/google/start` and `GET /auth/google/callback` (`src/routes/pointsRoutes.js`)
- **Public limiter:** 30 requests / min on the 5 public POST routes in `src/routes/viewRoutes.js`

The limiter is a small fixed-window in-memory middleware. It keys requests by `req.ip`, with `req.socket.remoteAddress` as the only fallback. Do not manually parse `x-forwarded-for`; Express's `req.ip` already applies the configured `trust proxy` policy.

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

## Admin Route Protection (`src/middleware/adminMiddleware.js`)

Admin routes are protected by **session-based authentication** via `requireSiteAdmin`. The login flow:

> The session flag is `req.session.siteAdmin` (not `isAdmin`) and the middleware is `requireSiteAdmin` (not `requireAdminSession`). The names were chosen so that a future `requireGroupAdmin` tier cannot accidentally widen to site-wide access.


1. User visits `GET /updates` → renders `adminLogin.ejs` with a "Sign in with Google" button
2. User submits the login form → `GET /auth/google/start` (`startGoogleAuth` in `pointsController.js`) optionally sets `req.session.rememberMe = true` (if `?remember=1`), generates a random `req.session.oauthState`, saves the session, then redirects to Google's OAuth consent screen via `getAuthUrl(oauthState)` in `src/config/auth.js`
3. Google redirects back to `GET /auth/google/callback` with an authorization code and OAuth `state`
4. `googleAuthCallback` consumes `req.session.oauthState` and rejects the callback before token exchange if `state` is missing or mismatched
5. `googleAuthCallback` exchanges the code for tokens via `getOAuthClient().getToken()`, then verifies the ID token via `verifyIdToken({ idToken, audience: getGoogleClientId() })`. **The `audience` pin (added 2026-05-17, C3 fix) is required** — without it, any signature-valid Google ID token issued for a different OAuth client would pass, relying on the `ADMIN_EMAILS` allowlist as the sole boundary. After token verification, checks the email against the `ADMIN_EMAILS` env var allowlist, calls `req.session.regenerate()`, then sets `req.session.siteAdmin = true` and `req.session.adminEmail`
6. If `rememberMe` was captured before session regeneration, `cookie.maxAge` is extended to 30 days; otherwise the default 8-hour session applies
7. All subsequent admin requests gated by `requireSiteAdmin`, which checks `req.session?.siteAdmin`
8. `POST /admin/logout` destroys the session and redirects to `/updates`

**OAuth `state` is required** and is reserved for login CSRF protection. Do not put remember-me or other application data inside the OAuth state value. Keep remember-me in the server-side session before redirecting to Google.

`startGoogleAuth` assigns `req.session.rememberMe = req.query.remember === "1"` on every start so a stale pre-login session cannot carry a previous checked remember-me value into a later unchecked login attempt.

Sessions persist in Firestore (`express-sessions` collection via `src/middleware/firestoreSessionStore.js`), surviving Cloud Run restarts and scale-out. **Do not reintroduce `requireAdminReferrer`** — removed intentionally, `Referer` header is not a security control.

Admin access is controlled by the `ADMIN_EMAILS` environment variable (comma-separated list of authorized Google email addresses). Configuration is centralized in `src/config/auth.js`.

## Session Lifecycle

`req.session.regenerate()` **must be called at every privilege transition** — before setting `siteAdmin`, `verifiedEntries`, or any other session flag that grants access. This prevents session fixation: an attacker who pre-sets a victim's session cookie cannot reuse it after the victim authenticates.

Pattern (both `myEntryVerify` in `viewController.js` and `googleAuthCallback` in `pointsController.js`):
1. Capture any data you want to carry across (e.g. `rememberMe`).
2. `await regenerate()` — destroys old session, creates new ID.
3. Set the privilege flags on `req.session`.
4. `await save()` — persists the new session before the redirect.

`regenerate()` and `save()` are both async callback-based; wrap them in `new Promise()`.

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

- In production JSON responses, internal details are replaced with generic messages.
- In non-production JSON responses, `message`, `operation`, and `service` details remain available for debugging.
- Server-side `Logger.error` calls keep the full error detail in all environments.

## Outstanding Security Items

- **Fix #10 (LOW):** CSRF tokens not added. ~30 forms across 18 view files need `<input type="hidden" name="_csrf">` and 4 AJAX calls need `x-csrf-token` header. Library candidate: `csrf-csrf`.

## Fixed

- **Internal error field disclosure narrowed (FIXED — 2026-05-17):** `DatabaseError.operation` and `ServiceError.service` are no longer exposed in JSON responses based on `NODE_ENV !== 'production'`. They now require an explicit `DEBUG_ERRORS=1` env var. Default behavior is generic-only in every environment, so staging / preview / test envs no longer leak Firestore operation names or service identifiers. Full detail still logged via `Logger.error`. See `tests/middleware.test.js` for the regression coverage.
- **Pending-confirmation save-after-DB race closed (FIXED — 2026-05-17):** `entryVerify` (`viewController.js`) now writes `req.session.pendingConfirmations[token]` and awaits `session.save` **before** calling `createNewEntry`. Previously a `session.save` failure after a successful Firestore insert produced a 500 with no token, and the user's retry would create a duplicate entry. See the C7 regression test in `tests/viewController.test.js`.
- **CSP / security-header regression coverage (FIXED — 2026-05-17):** `src/middleware/securityHeaders.js` was previously untested; CSP directive correctness, HSTS max-age, and the five required headers are now asserted in `tests/securityHeaders.test.js` (9 tests). Edits to the CSP table will fail loudly if they introduce wildcards, drop required hosts, or weaken `frame-src` / `object-src` / `form-action`.
- **OAuth audience pin (FIXED — 2026-05-17):** `verifyIdToken` is now called with `audience: getGoogleClientId()` in `googleAuthCallback`. Without it, any signature-valid Google ID token issued for a different OAuth client would have passed verification, falling back to the `ADMIN_EMAILS` allowlist as the sole boundary. The `audience` check is defense-in-depth — it rejects cross-client token reuse outright. See `tests/pointsController.test.js` for the regression coverage.
- **OAuth login CSRF (FIXED — 2026-05-09):** Google OAuth now uses a random session-backed state value generated in `startGoogleAuth`, passed through `getAuthUrl(state)`, validated in `googleAuthCallback`, and consumed before token exchange.
- **Public entry ownership hardening (FIXED — 2026-05-09):** `/my-entry/*` verification now uses `year:entryId` session keys. `myEntryUpdate` re-reads the stored entry and preserves server-owned fields instead of trusting public form fields.
- **Production internal error disclosure (FIXED — 2026-05-09):** `DatabaseError` and `ServiceError` JSON responses are generic in production while full details remain in server logs.
- **XSS (FIXED):** Backtick template literal injection in `registration.ejs`, `editEntry.ejs`, `myEditEntry.ejs`, `results.ejs` replaced with `safeJson` pattern.
- **Cache key info disclosure (FIXED):** `cacheDebugMiddleware` now only sets headers when `req.session?.siteAdmin` and `NODE_ENV !== 'production'`.
- **Session cookie sameSite (FIXED):** `sameSite: 'lax'` added to session cookie in `server.js`, mitigating cross-site request forgery on admin state-changing POSTs.
- **Session fixation (FIXED — 2026-05-02):** `req.session.regenerate()` added to `myEntryVerify` (`viewController.js`) and `googleAuthCallback` (`pointsController.js`) before setting session privilege flags. See Session Lifecycle section above.
- **PII in logs (FIXED — 2026-05-02):** `controllerUtils.js` now redacts sensitive request body fields (`email`, `name`, `picks`, `entryId`, etc.) in the controller start-log. `SENSITIVE_KEYS` and `redactBody()` are defined at the top of that file. Raw bodies no longer appear in Cloud Logging.
- **Entry confirm URL data leak (FIXED — 2026-05-02):** `/entryConfirm` no longer accepts picks and personal info via query params. `entryVerify` stores a 10-min session token (`req.session.pendingConfirmations[token]`) and redirects to `/entryConfirm?token=<nonce>`. `entryConfirm` reads and deletes the payload; invalid/expired tokens render `confirmExpired.ejs` (404).

## Related Files

- `docs/architecture/deployment.md` — Environment variables, Cloud Run config
- `docs/architecture/utilities.md` — Error classes and controller wrapper
