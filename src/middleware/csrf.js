/**
 * csrf.js
 * Synchronizer-token CSRF protection for state-changing POSTs (M2 / audit
 * finding 4 — the stored-XSS → CSRF-less deploy chain's terminal sink —
 * plus the public self-service entry-update path, #301).
 *
 * Hand-rolled per-session token rather than a dependency, in the same spirit
 * as securityHeaders.js replacing helmet. The token lives in the existing
 * session document, so no new Firestore reads/writes/collections are
 * introduced ($0 cost contract): attachCsrfToken only ever touches sessions
 * that already exist AND already carry siteAdmin, userEmail, or
 * verifiedEntries — anonymous traffic never causes a session write
 * (saveUninitialized: false stays effective).
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';

// Mints the per-session token if one isn't already present. base64url keeps the
// token safe to embed in HTML attributes and inline-script string literals
// without escaping.
//
// Exported so the login flow can mint EAGERLY at admin promotion (where
// regenerate+save already serialize) rather than relying on the lazy
// first-page-load path. Lazy minting races when an admin opens two tabs before
// any token exists: both mint different tokens, last-write-wins on the session
// doc, and the losing tab's rendered token fails verifyCsrf (#164).
export function ensureCsrfToken(req) {
  if (!req.session) return '';
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(32).toString('base64url');
  }
  return req.session.csrfToken;
}

/**
 * Global middleware (mounted after the session middleware in server.js).
 * Exposes the token to templates as res.locals.csrfToken — but only for
 * sessions that already exist (admin, authed user, or a verified public
 * entry), so anonymous public pages never trigger a session write.
 *
 * verifiedEntries sessions are included (#301): entryId/year are visible in
 * the URL, so without a token here /my-entry/update was forgeable via a
 * cross-site top-level form POST (SameSite=Lax only blocks subresource
 * requests, not navigations).
 */
export function attachCsrfToken(req, res, next) {
  if (
    req.session?.siteAdmin ||
    req.session?.userEmail ||
    req.session?.verifiedEntries
  ) {
    res.locals.csrfToken = ensureCsrfToken(req);
  }
  next();
}

/**
 * Route guard for state-changing POSTs. Mount AFTER any auth middleware
 * (requireSiteAdmin, requireUser, etc.) so unauthenticated callers still get
 * their 401/403 first, and CSRF only arbitrates requests that already carry
 * a valid session.
 *
 * Accepts the token from the x-csrf-token header (AJAX) or the _csrf body
 * field (HTML forms). Constant-time comparison; the length check is required
 * because timingSafeEqual throws on length mismatch.
 */
export function verifyCsrf(req, res, next) {
  const expected = req.session?.csrfToken;
  const provided = req.headers['x-csrf-token'] || req.body?._csrf;
  if (
    typeof expected === 'string' &&
    expected.length > 0 &&
    typeof provided === 'string'
  ) {
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return next();
    }
  }
  return res.status(403).json({
    error: 'Invalid or missing CSRF token. Refresh the page and try again.',
  });
}
