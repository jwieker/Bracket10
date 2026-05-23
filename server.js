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

import express from "express";
import session from "express-session";
import { FirestoreStore } from "./src/middleware/firestoreSessionStore.js";
import compression from "compression";
import { securityHeaders } from "./src/middleware/securityHeaders.js";
import gameRoutes from "./src/routes/gameRoutes.js";
import viewRoutes from "./src/routes/viewRoutes.js";
import pointsRoutes from "./src/routes/pointsRoutes.js";
import tourneyRoutes from "./src/routes/tourneyRoutes.js";
import indexRoutes from "./src/routes/indexRoutes.js";
import conferenceRoutes from "./src/routes/conferenceRoutes.js";
import adminRoutes from "./src/routes/adminRoutes.js";
import { errorMiddleware } from "./src/middleware/errorMiddleware.js";
import { retryOperation } from "./src/utils/dbUtils.js";
import { verifyDatabaseAccess } from "./src/utils/startupChecks.js";
import { cacheDebugMiddleware } from "./src/utils/cacheUtils.js";
import { db } from "./src/config/firestore.js";

// Express app configuration
const app = express();
const port = process.env.PORT || 8080;
app.set("trust proxy", 1);

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
app.locals.appHost = APP_HOST || "";
app.locals.gaMeasurementId = process.env.GA_MEASUREMENT_ID || "";

app.use(securityHeaders);
app.use(express.static("public"));

app.use(session({
  store: new FirestoreStore({
    dataset: db,
    kind: 'express-sessions',
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
}));
app.use(express.json()); // for parsing application/json
app.use(express.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

app.set("view engine", "ejs"); // Tell Express to use EJS

// Enable compression for all responses
app.use(
  compression({
    level: 9, // Compression level (0-9, 9 being highest)
    threshold: 0, // Compress all responses
  })
);

// Global debug headers
app.use(cacheDebugMiddleware);

// Routes
app.use("/", indexRoutes);
app.use("/", gameRoutes);
app.use("/", viewRoutes);
app.use("/", pointsRoutes);
app.use("/", tourneyRoutes);
app.use("/", conferenceRoutes);
app.use("/", adminRoutes);

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
    console.log(`Logging bad site resource: ${req.path} from IP ${req.ip}`);
    res.status(403).send("Access Forbidden");
  }
);

//blocks anything expressly not in the routes folder
app.use((req, res) => {
  console.log(
    `Blocked access to undefined route: ${req.path} from IP ${req.ip}`
  );
  res.status(404).send("");
});

// Global error handler (must be after all routes and other middleware)
app.use(errorMiddleware);

app.listen(port, async () => {
  try {
    await retryOperation(verifyDatabaseAccess);
    console.log(`Server running on http://localhost:${port}`);
  } catch (error) {
    console.error(
      "Failed to initialize critical services after multiple retries:",
      error.message
    );
    process.exit(1);
  }
});
