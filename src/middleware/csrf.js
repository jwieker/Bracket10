/**
 * csrf.js
 * Synchronizer-token CSRF protection for the admin console (M2 / audit
 * finding 4 — the stored-XSS → CSRF-less deploy chain's terminal sink).
 *
 * Hand-rolled per-session token rather than a dependency, in the same spirit
 * as securityHeaders.js replacing helmet. The token lives in the existing
 * admin session document, so no new Firestore reads/writes/collections are
 * introduced ($0 cost contract): attachCsrfToken only ever touches sessions
 * that already exist AND already carry siteAdmin — anonymous traffic never
 * causes a session write (saveUninitialized: false stays effective).
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

// Lazily mints the per-session token. base64url keeps the token safe to embed
// in HTML attributes and inline-script string literals without escaping.
function ensureCsrfToken(req) {
    if (!req.session) return "";
    if (!req.session.csrfToken) {
        req.session.csrfToken = randomBytes(32).toString("base64url");
    }
    return req.session.csrfToken;
}

/**
 * Global middleware (mounted after the session middleware in server.js).
 * Exposes the token to templates as res.locals.csrfToken — but only for
 * admin sessions, so public pages never trigger a session write.
 */
export function attachCsrfToken(req, res, next) {
    if (req.session?.siteAdmin) {
        res.locals.csrfToken = ensureCsrfToken(req);
    }
    next();
}

/**
 * Route guard for state-changing admin POSTs. Mount AFTER requireSiteAdmin so
 * unauthenticated callers still get the 401, and CSRF only arbitrates
 * requests that already carry a valid admin session.
 *
 * Accepts the token from the x-csrf-token header (AJAX) or the _csrf body
 * field (HTML forms). Constant-time comparison; the length check is required
 * because timingSafeEqual throws on length mismatch.
 */
export function verifyCsrf(req, res, next) {
    const expected = req.session?.csrfToken;
    const provided = req.headers["x-csrf-token"] || req.body?._csrf;
    if (typeof expected === "string" && expected.length > 0 && typeof provided === "string") {
        const a = Buffer.from(expected);
        const b = Buffer.from(provided);
        if (a.length === b.length && timingSafeEqual(a, b)) {
            return next();
        }
    }
    return res.status(403).json({
        error: "Invalid or missing CSRF token. Refresh the page and try again.",
    });
}
