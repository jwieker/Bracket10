import {
  updatePossiblePoints,
  possibleRanking,
} from "../services/index.js";
import { randomBytes } from "node:crypto";
import { thisYear, APP_CONFIG } from "../config/app.js";
import { getAuthUrl, getGoogleClientId, getOAuthClient, isAdminEmail } from "../config/auth.js";
import { controllerWrapper, parseYearOrDefault, saveSession, regenerateSession } from "../utils/controllerUtils.js";
import { clearAllCache } from "../utils/cacheUtils.js";
import Logger from "../utils/logger.js";
import { sessionRepository } from "../repositories/index.js";

const adminLogin = (req, res) => {
  if (req.session?.siteAdmin) {
    return res.redirect("/admin/tournament");
  }
  res.render("adminLogin");
};

const startGoogleAuth = controllerWrapper(async (req, res) => {
  req.session.rememberMe = req.query.remember === "1";
  req.session.oauthRole = "admin";
  const oauthState = randomBytes(16).toString("hex");
  req.session.oauthState = oauthState;
  await saveSession(req);
  res.redirect(getAuthUrl(oauthState));
}, "startGoogleAuth");

// Participant ("My Brackets") sign-in. Mirrors startGoogleAuth but tags the
// session role as "user" so the shared callback branches to the non-privileged
// path. Reuses the same OAuth client, scopes, and registered redirect URI.
const startUserGoogleAuth = controllerWrapper(async (req, res) => {
  req.session.oauthRole = "user";
  const oauthState = randomBytes(16).toString("hex");
  req.session.oauthState = oauthState;
  await saveSession(req);
  res.redirect(getAuthUrl(oauthState));
}, "startUserGoogleAuth");

const googleAuthCallback = controllerWrapper(async (req, res) => {
  const { code, state } = req.query;
  const expectedState = req.session.oauthState;
  // Role lives in the session (not the client-visible state), so it cannot be
  // tampered with. Default to "admin" so any pre-existing flow is unaffected.
  const role = req.session.oauthRole === "user" ? "user" : "admin";
  delete req.session.oauthState;
  delete req.session.oauthRole;

  // Where to send the user back on a recoverable failure (missing code, etc.).
  const loginPath = role === "user" ? "/" : "/updates";

  if (!code) {
    return res.redirect(loginPath);
  }

  if (!state || !expectedState || state !== expectedState) {
    Logger.warn("[googleAuthCallback] OAuth state mismatch");
    return res.status(403).send("Authentication failed: invalid state");
  }

  let tokens;
  try {
    const result = await getOAuthClient().getToken(code);
    tokens = result.tokens;
  } catch (error) {
    Logger.error("[googleAuthCallback] getToken failed:", { message: error?.message, data: error?.response?.data });
    return res.status(401).send("Authentication failed: token exchange");
  }

  let email;
  try {
    const ticket = await getOAuthClient().verifyIdToken({
      idToken: tokens.id_token,
      // Without audience, any signature-valid Google ID token (e.g. one issued
      // for a different OAuth client) would pass. Pinning to our client ID
      // rejects cross-client token reuse outright instead of relying on the
      // admin-email allowlist as the sole boundary.
      audience: getGoogleClientId(),
    });
    email = ticket.getPayload().email;
  } catch (error) {
    Logger.error("[googleAuthCallback] verifyIdToken failed:", { message: error?.message });
    return res.status(401).send("Authentication failed: token verification");
  }

  if (!email) {
    Logger.warn("[googleAuthCallback] No email on verified token");
    return res.status(403).send("Authentication failed: no email");
  }

  // Participant flow: any verified Google email is accepted. Grants ONLY
  // req.session.userEmail — never siteAdmin — so it confers no admin access.
  if (role === "user") {
    // Snapshot existing admin login so both can coexist after regeneration.
    const existingSiteAdmin = req.session.siteAdmin;
    const existingAdminEmail = req.session.adminEmail;
    const existingCsrfToken = req.session.csrfToken;
    const existingMaxAge = req.session.cookie?.maxAge;

    await regenerateSession(req);
    // Store lowercased so all downstream ownership comparisons are case-insensitive.
    req.session.userEmail = email.toLowerCase();
    const userMaxAge = 14 * 24 * 60 * 60 * 1000; // 2 weeks
    req.session.cookie.maxAge = Math.max(userMaxAge, existingMaxAge || 0);

    if (existingSiteAdmin) {
      req.session.siteAdmin = existingSiteAdmin;
      req.session.adminEmail = existingAdminEmail;
      if (existingCsrfToken) req.session.csrfToken = existingCsrfToken;
    }
    try {
      await saveSession(req);
    } catch (error) {
      Logger.error("[googleAuthCallback] user session.save failed:", error);
      return res.status(500).send("Session save failed");
    }
    return res.redirect("/my-brackets");
  }

  // Admin flow: gated by the ADMIN_EMAILS allowlist.
  if (!isAdminEmail(email)) {
    Logger.warn(`[googleAuthCallback] Unauthorized email: ${email}`);
    return res.status(403).send("Not an authorized admin");
  }

  const rememberMe = req.session.rememberMe;
  // Snapshot existing user login so both can coexist after regeneration.
  const existingUserEmail = req.session.userEmail;
  const existingMaxAge = req.session.cookie?.maxAge;

  await regenerateSession(req);
  req.session.siteAdmin = true;
  req.session.adminEmail = email;
  if (existingUserEmail) req.session.userEmail = existingUserEmail;
  const adminMaxAge = rememberMe
    ? 30 * 24 * 60 * 60 * 1000 // 30 days
    : 8 * 60 * 60 * 1000; // 8 hours (session default)
  req.session.cookie.maxAge = Math.max(adminMaxAge, existingMaxAge || 0);
  // Promisify + await so any save failure (or downstream redirect throw) is
  // routed through controllerWrapper rather than escaping as an unhandled rejection.
  try {
    await saveSession(req);
  } catch (error) {
    Logger.error("[googleAuthCallback] session.save failed:", error);
    return res.status(500).send("Session save failed");
  }
  return res.redirect("/admin/tournament");
}, "googleAuthCallback");

// Participant sign-out. POST-only (registered in pointsRoutes) so it can't be
// triggered cross-site. Only clears the user portion so an active admin login
// in the same session is preserved.
const userLogout = (req, res) => {
  delete req.session.userEmail;
  if (req.session.siteAdmin) {
    req.session.save(() => res.redirect("/"));
  } else {
    req.session.destroy(() => res.redirect("/"));
  }
};

const updateTotalPoints = controllerWrapper(async (req, res) => {
  const year = parseYearOrDefault(req.body.year, thisYear);
  clearAllCache();
  await updatePossiblePoints(year);
  clearAllCache();
  res.status(200).json(`👍👍All teams scores updated successfully and cleared cache👍👍`);
}, "updateTotalPoints");

async function updateTotalPointsJustYear(year = thisYear) {
  try {
    // No need to clearAllCache() before — the repository layer already
    // invalidates game/team cache keys after each write (updateWinner,
    // updateNextGameTeam, updateTeamRecord).  Clearing here would
    // unnecessarily bust unrelated caches (entries, teams) that are
    // still valid and about to be read by updatePossiblePoints.
    await updatePossiblePoints(year);
    clearAllCache(); // Bust cache after entry-point writes so pages serve fresh data
    return;
  } catch (error) {
    Logger.error("Error in updateTotalPointsJustYear:", error);
  }
};

const getPossibleRanking = controllerWrapper(async (req, res) => {
  const currentYear = parseYearOrDefault(req.body.year, thisYear);
  const sortedPointsArray = await possibleRanking(currentYear, APP_CONFIG.tournament.defaultGroup);
  const rankingResults = [];
  for (const entry of sortedPointsArray) {
    if (entry.highestPlace) {
      rankingResults.push(
        `${entry.highestPlace}: ${entry.name},    tied with: ${entry.ties}`
      );
    }
  }
  res.render("possibleRanking", { rankingResults });
}, "getPossibleRanking");

const clearCacheHandler = controllerWrapper((req, res) => {
  clearAllCache();
  res.status(200).json("👍👍Cache cleared successfully👍👍");
}, "clearCacheHandler");

const clearGoogleSessionsHandler = controllerWrapper(async (req, res) => {
  const count = await sessionRepository.clearAuthenticatedSessions();
  res.status(200).json(`Successfully cleared ${count} Google sign-in session(s).`);
}, "clearGoogleSessionsHandler");

export {
  adminLogin,
  startGoogleAuth,
  startUserGoogleAuth,
  googleAuthCallback,
  userLogout,
  updateTotalPoints,
  updateTotalPointsJustYear,
  getPossibleRanking,
  clearCacheHandler,
  clearGoogleSessionsHandler,
};
