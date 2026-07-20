import { updatePossiblePoints, possibleRanking } from '../services/index.js';
import { randomBytes } from 'node:crypto';
import { thisYear, APP_CONFIG } from '../config/app.js';
import {
  getAuthUrl,
  getGoogleClientId,
  getOAuthClient,
  isAdminEmail,
} from '../config/auth.js';
import {
  controllerWrapper,
  parseYearOrDefault,
  saveSession,
  regenerateSession,
  destroySession,
} from '../utils/controllerUtils.js';
import { clearAllCache } from '../utils/cacheUtils.js';
import Logger from '../utils/logger.js';
import { sessionRepository } from '../repositories/index.js';
import { ensureCsrfToken } from '../middleware/csrf.js';
import { sanitizeLogField } from '../middleware/securityHeaders.js';

const adminLogin = (req, res) => {
  if (req.session?.siteAdmin) {
    return res.redirect('/admin/tournament');
  }
  res.render('adminLogin');
};

const startGoogleAuth = controllerWrapper(async (req, res) => {
  req.session.rememberMe = req.query.remember === '1';
  req.session.oauthRole = 'admin';
  const oauthState = randomBytes(16).toString('hex');
  req.session.oauthState = oauthState;
  await saveSession(req);
  res.redirect(getAuthUrl(oauthState));
}, 'startGoogleAuth');

// Participant ("My Brackets") sign-in. Mirrors startGoogleAuth but tags the
// session role as "user" so the shared callback branches to the non-privileged
// path. Reuses the same OAuth client, scopes, and registered redirect URI.
const startUserGoogleAuth = controllerWrapper(async (req, res) => {
  req.session.oauthRole = 'user';
  const oauthState = randomBytes(16).toString('hex');
  req.session.oauthState = oauthState;
  await saveSession(req);
  res.redirect(getAuthUrl(oauthState));
}, 'startUserGoogleAuth');

async function extractGoogleEmail(code) {
  let tokens;
  try {
    const result = await getOAuthClient().getToken(code);
    tokens = result.tokens;
  } catch (error) {
    Logger.error('[googleAuthCallback] getToken failed:', {
      message: error?.message,
      data: error?.response?.data,
    });
    // Client-facing body stays generic across every failure branch — the staged
    // "token exchange" / "token verification" / "no email" text was an oracle
    // that let a probe pinpoint where a forged/replayed flow broke. The specific
    // reason lives only in this server-side log line.
    return { error: true, status: 401, message: 'Authentication failed' };
  }

  let payload;
  try {
    const ticket = await getOAuthClient().verifyIdToken({
      idToken: tokens.id_token,
      // Without audience, any signature-valid Google ID token (e.g. one issued
      // for a different OAuth client) would pass. Pinning to our client ID
      // rejects cross-client token reuse outright instead of relying on the
      // admin-email allowlist as the sole boundary.
      audience: getGoogleClientId(),
    });
    payload = ticket.getPayload();
  } catch (error) {
    Logger.error('[googleAuthCallback] verifyIdToken failed:', {
      message: error?.message,
    });
    return { error: true, status: 401, message: 'Authentication failed' };
  }

  const email = payload?.email;
  if (!email) {
    Logger.warn('[googleAuthCallback] No email on verified token');
    return { error: true, status: 403, message: 'Authentication failed' };
  }

  // Google verifies token signatures, not email ownership: an account can
  // carry an alternate address it never proved control of, and that address
  // arrives here with email_verified:false. Since entry ownership and the
  // admin allowlist key entirely on this email, trusting an unverified claim
  // would let anyone impersonate a participant (or admin) by adding the
  // victim's address as an unverified alias (#333). Strict === true so a
  // missing claim fails closed.
  if (payload.email_verified !== true) {
    Logger.warn(
      `[googleAuthCallback] Unverified email claim rejected: ${sanitizeLogField(email)}`,
    );
    return { error: true, status: 403, message: 'Authentication failed' };
  }

  return { email };
}

async function handleUserLogin(req, res, email) {
  // Snapshot existing admin login so both can coexist after regeneration.
  const existingSiteAdmin = req.session.siteAdmin;
  const existingAdminEmail = req.session.adminEmail;
  const existingCsrfToken = req.session.csrfToken;
  const existingMaxAge = req.session.cookie?.maxAge;

  await regenerateSession(req);
  // Store lowercased so all downstream ownership comparisons are case-insensitive.
  req.session.userEmail = email.toLowerCase();
  const userMaxAge = 14 * 24 * 60 * 60 * 1000; // 2 weeks
  // Participant coexistence must never lengthen an admin session (#426): an
  // admin who also signs into "My Brackets" keeps whatever maxAge their admin
  // login already capped the cookie to (8h, or 30d with remember-me) instead
  // of Math.max-ing it up to the 2-week participant lifetime.
  req.session.cookie.maxAge = existingSiteAdmin
    ? existingMaxAge
    : Math.max(userMaxAge, existingMaxAge || 0);
  ensureCsrfToken(req);

  if (existingSiteAdmin) {
    req.session.siteAdmin = existingSiteAdmin;
    req.session.adminEmail = existingAdminEmail;
    if (existingCsrfToken) req.session.csrfToken = existingCsrfToken;
  }
  try {
    await saveSession(req);
  } catch (error) {
    Logger.error('[googleAuthCallback] user session.save failed:', error);
    return res.status(500).send('Session save failed');
  }
  return res.redirect('/my-brackets');
}

async function handleAdminLogin(req, res, email) {
  // Admin flow: gated by the ADMIN_EMAILS allowlist.
  if (!isAdminEmail(email)) {
    Logger.warn(
      `[googleAuthCallback] Unauthorized email: ${sanitizeLogField(email)}`,
    );
    // Same generic body as the other failure branches — a distinct message here
    // would let a probe with a valid Google token enumerate the ADMIN_EMAILS
    // allowlist by email.
    return res.status(403).send('Authentication failed');
  }

  const rememberMe = req.session.rememberMe;
  // Snapshot existing user login so both can coexist after regeneration.
  const existingUserEmail = req.session.userEmail;

  await regenerateSession(req);
  req.session.siteAdmin = true;
  req.session.adminEmail = email;
  if (existingUserEmail) req.session.userEmail = existingUserEmail;
  const adminMaxAge = rememberMe
    ? 30 * 24 * 60 * 60 * 1000 // 30 days
    : 8 * 60 * 60 * 1000; // 8 hours (session default)
  // A fresh admin login always sets the documented 8h/30d admin lifetime
  // (#426) — it must not inherit a longer-lived maxAge left over from a
  // coexisting participant login via Math.max, or the admin console's
  // session-length policy is silently voided by prior "My Brackets" use.
  req.session.cookie.maxAge = adminMaxAge;
  // Mint the CSRF token eagerly here — this save serializes the freshly
  // regenerated admin session, so the token is persisted before any admin page
  // loads. Avoids the lazy-mint race where two tabs opened before any token
  // exists each mint a different token and the losing tab 403s on POST (#164).
  ensureCsrfToken(req);
  // Promisify + await so any save failure (or downstream redirect throw) is
  // routed through controllerWrapper rather than escaping as an unhandled rejection.
  try {
    await saveSession(req);
  } catch (error) {
    Logger.error('[googleAuthCallback] session.save failed:', error);
    return res.status(500).send('Session save failed');
  }
  return res.redirect('/admin/tournament');
}

const googleAuthCallback = controllerWrapper(async (req, res) => {
  const { code, state } = req.query;
  const expectedState = req.session.oauthState;
  // Role lives in the session (not the client-visible state), so it cannot be
  // tampered with. Default to "admin" so any pre-existing flow is unaffected.
  const role = req.session.oauthRole === 'user' ? 'user' : 'admin';
  delete req.session.oauthState;
  delete req.session.oauthRole;

  // Where to send the user back on a recoverable failure (missing code, etc.).
  const loginPath = role === 'user' ? '/' : '/updates';

  if (!code) {
    return res.redirect(loginPath);
  }

  if (!state || !expectedState || state !== expectedState) {
    Logger.warn('[googleAuthCallback] OAuth state mismatch');
    return res.status(403).send('Authentication failed');
  }

  const { email, error, status, message } = await extractGoogleEmail(code);
  if (error) {
    return res.status(status).send(message);
  }

  // Participant flow: any verified Google email is accepted. Grants ONLY
  // req.session.userEmail — never siteAdmin — so it confers no admin access.
  if (role === 'user') {
    return handleUserLogin(req, res, email);
  }

  return handleAdminLogin(req, res, email);
}, 'googleAuthCallback');

// Participant sign-out. POST-only (registered in pointsRoutes) so it can't be
// triggered cross-site. Only clears the user portion so an active admin login
// in the same session is preserved.
const userLogout = async (req, res) => {
  delete req.session.userEmail;
  try {
    if (req.session.siteAdmin) {
      await saveSession(req);
    } else {
      await destroySession(req);
    }
  } catch (error) {
    // A failed store write here leaves userEmail persisted server-side even though we
    // just deleted it in memory; redirecting as if logout succeeded would show the user
    // "logged out" while the next request re-reads an authenticated session (#368).
    Logger.error('[userLogout] session save/destroy failed:', error);
    return res.status(500).send('Logout failed');
  }
  return res.redirect('/');
};

const updateTotalPoints = controllerWrapper(async (req, res) => {
  const year = parseYearOrDefault(req.body.year, thisYear);
  clearAllCache();
  await updatePossiblePoints(year);
  clearAllCache();
  res
    .status(200)
    .json(`👍👍All teams scores updated successfully and cleared cache👍👍`);
}, 'updateTotalPoints');

const getPossibleRanking = controllerWrapper(async (req, res) => {
  const currentYear = parseYearOrDefault(req.body.year, thisYear);
  const sortedPointsArray = await possibleRanking(
    currentYear,
    APP_CONFIG.tournament.defaultGroup,
  );
  const rankingResults = [];
  for (const entry of sortedPointsArray) {
    if (entry.highestPlace) {
      rankingResults.push(
        `${entry.highestPlace}: ${entry.name},    tied with: ${entry.ties}`,
      );
    }
  }
  res.render('possibleRanking', { rankingResults });
}, 'getPossibleRanking');

const clearCacheHandler = controllerWrapper((req, res) => {
  clearAllCache();
  res.status(200).json('👍👍Cache cleared successfully👍👍');
}, 'clearCacheHandler');

const clearGoogleSessionsHandler = controllerWrapper(async (req, res) => {
  // Opt-in full incident response (#428): also deletes merged/admin-only
  // session docs instead of the default scope, which preserves an active
  // admin console session riding on a merged doc.
  const includeAdmins = req.body?.includeAdmins === true;
  const { deleted, strippedAdminDocs } =
    await sessionRepository.clearAuthenticatedSessions({ includeAdmins });
  const adminNote = strippedAdminDocs
    ? ` (${strippedAdminDocs} admin session(s) kept signed in; only the Google sign-in half was cleared)`
    : '';
  res
    .status(200)
    .json(
      `Successfully cleared ${deleted} Google sign-in session(s).${adminNote}`,
    );
}, 'clearGoogleSessionsHandler');

export {
  adminLogin,
  startGoogleAuth,
  startUserGoogleAuth,
  googleAuthCallback,
  userLogout,
  updateTotalPoints,
  getPossibleRanking,
  clearCacheHandler,
  clearGoogleSessionsHandler,
};
