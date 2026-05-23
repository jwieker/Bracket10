import {
  updatePossiblePoints,
  possibleRanking,
} from "../services/index.js";
import { randomBytes } from "node:crypto";
import { thisYear, APP_CONFIG } from "../config/app.js";
import { getAuthUrl, getGoogleClientId, getOAuthClient, isAdminEmail } from "../config/auth.js";
import { controllerWrapper, parseYearOrDefault } from "../utils/controllerUtils.js";
import { clearAllCache } from "../utils/cacheUtils.js";
import Logger from "../utils/logger.js";

const adminLogin = (req, res) => {
  if (req.session?.siteAdmin) {
    return res.redirect("/admin/tournament");
  }
  res.render("adminLogin");
};

const startGoogleAuth = controllerWrapper(async (req, res) => {
  req.session.rememberMe = req.query.remember === "1";
  const oauthState = randomBytes(16).toString("hex");
  req.session.oauthState = oauthState;
  await new Promise((resolve, reject) => {
    req.session.save((err) => err ? reject(err) : resolve());
  });
  res.redirect(getAuthUrl(oauthState));
}, "startGoogleAuth");

const googleAuthCallback = controllerWrapper(async (req, res) => {
  const { code, state } = req.query;
  const expectedState = req.session.oauthState;
  delete req.session.oauthState;

  if (!code) {
    return res.redirect("/updates");
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

  if (!email || !isAdminEmail(email)) {
    Logger.warn(`[googleAuthCallback] Unauthorized email: ${email}`);
    return res.status(403).send("Not an authorized admin");
  }

  const rememberMe = req.session.rememberMe;
  await new Promise((resolve, reject) => {
    req.session.regenerate((err) => err ? reject(err) : resolve());
  });
  req.session.siteAdmin = true;
  req.session.adminEmail = email;
  if (rememberMe) {
    req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
  }
  // Promisify + await so any save failure (or downstream redirect throw) is
  // routed through controllerWrapper rather than escaping as an unhandled rejection.
  try {
    await new Promise((resolve, reject) => {
      req.session.save((err) => err ? reject(err) : resolve());
    });
  } catch (error) {
    Logger.error("[googleAuthCallback] session.save failed:", error);
    return res.status(500).send("Session save failed");
  }
  return res.redirect("/admin/tournament");
}, "googleAuthCallback");

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

export {
  adminLogin,
  startGoogleAuth,
  googleAuthCallback,
  updateTotalPoints,
  updateTotalPointsJustYear,
  getPossibleRanking,
  clearCacheHandler,
};
