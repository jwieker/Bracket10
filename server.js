/**
 * Bracket 10 Tournament Application
 *
 * @file server.js
 * @description Main server application handling tournament brackets, scoring, and game management
 * @requires express
 * @requires @google-cloud/firestore
 *
 * @version 1.1.0
 * @copyright 2025
 */

import express from 'express';
import session from 'express-session';
import { FirestoreStore } from './src/middleware/firestoreSessionStore.js';
import compression from 'compression';
import {
  securityHeaders,
  CSP_REPORT_PATH,
  isCspReportOnlyEnabled,
  logCspReport,
} from './src/middleware/securityHeaders.js';
import { rateLimit } from './src/middleware/rateLimit.js';
import { attachCsrfToken } from './src/middleware/csrf.js';
import gameRoutes from './src/routes/gameRoutes.js';
import viewRoutes from './src/routes/viewRoutes.js';
import pointsRoutes from './src/routes/pointsRoutes.js';
import tourneyRoutes from './src/routes/tourneyRoutes.js';
import indexRoutes from './src/routes/indexRoutes.js';
import conferenceRoutes from './src/routes/conferenceRoutes.js';
import adminRoutes from './src/routes/adminRoutes.js';
import { errorMiddleware } from './src/middleware/errorMiddleware.js';
import { retryOperation } from './src/utils/dbUtils.js';
import Logger from './src/utils/logger.js';
import { safeJsonForScript } from './src/utils/htmlSafe.js';
import { verifyDatabaseAccess } from './src/utils/startupChecks.js';
import { cacheDebugMiddleware } from './src/utils/cacheUtils.js';
import { db } from './src/config/firestore.js';

// Ensure required environment variables are set before starting
if (!process.env.SESSION_SECRET) {
  Logger.error(
    'SESSION_SECRET environment variable is missing. Server cannot start securely.',
  );
  throw new Error('SESSION_SECRET is required');
}

// Express app configuration
const app = express();
const port = process.env.PORT || 8080;
// Cloud Run places exactly one trusted proxy (Google's front end) in front of
// the container, and it appends the real client IP as the rightmost
// X-Forwarded-For entry, so `trust proxy = 1` makes `req.ip` the true client
// address — which the per-IP rate limiters depend on. This is correct ONLY for
// Cloud Run. App Engine Standard's rightmost XFF hop is a Google-internal
// address, so deploying there would collapse every client into one rate-limit
// bucket. The vestigial `app.yaml` that enabled an accidental GAE deploy has
// been removed (#160); keep this value matched to the Cloud Run deployment.
app.set('trust proxy', 1);

// Canonicalize host: redirect www.<APP_HOST> → <APP_HOST>.
// The Google OAuth callback URL is registered on the apex domain, so a
// session cookie set on www.* is not sent to the callback and the
// oauthState check would fail. Set APP_HOST=example.com in production
// to enable; leave unset locally and this redirect becomes a no-op.
const APP_HOST = process.env.APP_HOST;
if (APP_HOST) {
  app.use((req, res, next) => {
    if (req.hostname === `www.${APP_HOST}`) {
      return res.redirect(308, `https://${APP_HOST}${req.originalUrl}`);
    }
    next();
  });
}

// Template globals. Both are empty when not configured — templates must
// treat them as optional so the public, unbranded build renders cleanly.
app.locals.appHost = APP_HOST || '';
app.locals.gaMeasurementId = process.env.GA_MEASUREMENT_ID || '';
// Shared XSS-safe JSON serializer for embedding server data in <script> blocks (#285).
// Replaces the hand-rolled `JSON.stringify(x).replace(/</g, '<')` guards in views.
app.locals.safeJson = safeJsonForScript;

app.use(securityHeaders);
app.use(express.static('public'));

app.use(
  session({
    store: new FirestoreStore({
      dataset: db,
      kind: 'express-sessions',
    }),
    // `__Host-` is a browser-enforced prefix: the cookie must be Secure, host-only
    // (no Domain) and path=/, and no subdomain or non-HTTPS page can set or
    // overwrite it — closing subdomain cookie-injection / fixation. The cookie
    // config below already satisfies those requirements (secure in prod, no domain
    // set, default path=/). Only applied in production because the prefix requires
    // Secure, which we don't set on plain-HTTP local dev. `name` is a top-level
    // express-session option, NOT a cookie field.
    name:
      process.env.NODE_ENV === 'production'
        ? '__Host-bracket.sid'
        : 'bracket.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    },
  }),
);
app.use(express.json()); // for parsing application/json
app.use(express.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

// Per-session CSRF token for the admin console (res.locals.csrfToken).
// Admin sessions only — never creates a session for anonymous traffic, so
// saveUninitialized:false (and the $0 cost contract) stay intact. The
// matching verifyCsrf guard sits on every state-changing admin POST.
app.use(attachCsrfToken);

app.set('view engine', 'ejs'); // Tell Express to use EJS

// Enable compression for all responses
app.use(
  compression({
    level: 9, // Compression level (0-9, 9 being highest)
    threshold: 0, // Compress all responses
  }),
);

// Global debug headers
app.use(cacheDebugMiddleware);

// Routes
app.use('/', indexRoutes);
app.use('/', gameRoutes);
app.use('/', viewRoutes);
app.use('/', pointsRoutes);
app.use('/', tourneyRoutes);
app.use('/', conferenceRoutes);
app.use('/', adminRoutes);

// CSP violation sink for the report-only policy (see securityHeaders.js).
// Logs to stdout only — no Firestore, no third party. Rate-limited to cap log
// volume, and silenced entirely by the CSP_REPORT_ONLY kill switch.
app.post(
  CSP_REPORT_PATH,
  rateLimit({ windowMs: 60 * 1000, max: 30 }),
  // Only the two content types browsers actually send for CSP violations —
  // generic application/json is dropped to cut trivially-scriptable abuse
  // (audit finding 3 defense-in-depth).
  express.json({
    type: ['application/csp-report', 'application/reports+json'],
    limit: '10kb',
  }),
  (req, res) => {
    if (isCspReportOnlyEnabled()) {
      logCspReport(req.body);
    }
    res.status(204).end();
  },
);

// Block wp-admin access attempts
app.use(
  [
    /^.*\.php.*$/,
    /^.*\/wp-admin.*$/,
    /^.*\/wp-.*$/,
    /^.*\.env.*$/,
    /^.*\.git.*$/,
  ],
  (req, res) => {
    Logger.info(`Logging bad site resource: ${req.path} from IP ${req.ip}`);
    res.status(403).send('Access Forbidden');
  },
);

//blocks anything expressly not in the routes folder
app.use((req, res) => {
  Logger.info(
    `Blocked access to undefined route: ${req.path} from IP ${req.ip}`,
  );
  res.status(404).send('');
});

// Global error handler (must be after all routes and other middleware)
app.use(errorMiddleware);

app.listen(port, async () => {
  try {
    await retryOperation(verifyDatabaseAccess);
    Logger.info(`Server running on http://localhost:${port}`);
  } catch (error) {
    Logger.error(
      'Failed to initialize critical services after multiple retries',
      error,
    );
    process.exit(1);
  }
});
