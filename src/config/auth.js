/**
 * auth.js
 * Google OAuth configuration for admin authentication.
 *
 * Uses the standard OAuth 2.0 authorization code flow:
 * 1. User clicks "Sign in with Google" link → redirected to Google
 * 2. Google redirects back to /auth/google/callback with a code
 * 3. Server exchanges code for tokens, reads email from ID token
 *
 * Environment variables are read lazily (via getters) so that values
 * loaded via --env-file are available at call time rather than import time.
 */
import { OAuth2Client } from "google-auth-library";

let _client;

export function getGoogleClientId() {
  return process.env.GOOGLE_CLIENT_ID;
}

export function getOAuthClient() {
  if (!_client) {
    _client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      getRedirectUri()
    );
  }
  return _client;
}

function getRedirectUri() {
  // Explicit override — use this for tunnels, preview envs, or any setup
  // where the callback URL doesn't follow the `https://<APP_HOST>/...` pattern.
  if (process.env.REDIRECT_URI) {
    return process.env.REDIRECT_URI;
  }
  // In production, set APP_HOST (e.g. APP_HOST=example.com) so the
  // redirect URI matches what's registered in Google Cloud Console.
  if (process.env.NODE_ENV === "production" && process.env.APP_HOST) {
    return `https://${process.env.APP_HOST}/auth/google/callback`;
  }
  return `http://localhost:${process.env.PORT || 8080}/auth/google/callback`;
}

export function getAuthUrl(state) {
  return getOAuthClient().generateAuthUrl({
    access_type: "online",
    scope: ["email", "profile"],
    prompt: "select_account",
    state,
  });
}

export function isAdminEmail(email) {
  if (!email) return false;
  const adminEmails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return adminEmails.includes(email.toLowerCase());
}

export const _getRedirectUriForTests = getRedirectUri;
