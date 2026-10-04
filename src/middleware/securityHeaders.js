// Replaces helmet: CSP, Referrer-Policy, X-Content-Type-Options, X-Frame-Options, HSTS.
import { randomBytes } from 'node:crypto';
import Logger from '../utils/logger.js';

// Path the report-only CSP points its violation reports at. Exported so the
// route in server.js and the tests share a single source of truth.
export const CSP_REPORT_PATH = '/csp-report';

// Base directives shared by the enforcing and report-only policies. `script-src`
// is intentionally NOT here — it is composed per request with the live nonce
// (see buildScriptSrc / serializeWithScript). `script-src-attr` is gone entirely:
// all inline `on*=` event handlers have been migrated to delegated listeners
// (views/partials/scripts.ejs), so inline event-handler attributes no longer
// need to be allowed. (#165 — the enforce flip.)
const BASE_DIRECTIVES = {
  'default-src': ["'self'"],
  // Without this, an HTML-injection bug (e.g. an unescaped value landing in
  // markup) can inject a <base href="https://attacker.example/"> tag that
  // rewrites every root-relative resource on the page — including the
  // nonce'd <script src="/js/...">  loaders — to load from an attacker
  // origin, turning injection into full script execution despite the nonce
  // policy having nothing wrong with it (#427). 'self' matches the
  // root-relative script/link paths already used throughout the views.
  'base-uri': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
  'img-src': ["'self'", 'data:', 'https:'],
  'connect-src': [
    "'self'",
    'https://www.google-analytics.com',
    'https://region1.google-analytics.com',
    'https://cdn.jsdelivr.net',
  ],
  'font-src': ["'self'", 'https://cdn.jsdelivr.net'],
  'frame-src': ["'none'"],
  'object-src': ["'none'"],
  'form-action': ["'self'", 'https://accounts.google.com'],
};

const serializeDirectives = (directives) =>
  Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(' ')}`)
    .join('; ');

// Strict, nonce-based script-src with no 'unsafe-inline'. 'strict-dynamic' lets
// the nonce'd loaders pull the CDN deps (Bootstrap, jQuery, GA) so the host
// allowlist is no longer needed for scripts; `https:` is kept only as a fallback
// for browsers that don't honor 'strict-dynamic'. A reflected/stored injection
// that isn't nonce'd now produces inert markup instead of executing.
function buildScriptSrc(nonce) {
  return ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", 'https:'];
}

// Composes the full directive set with a per-request script-src.
function buildEnforcedHeader(nonce) {
  return serializeDirectives({
    ...BASE_DIRECTIVES,
    'script-src': buildScriptSrc(nonce),
  });
}

// Report-only is on by default; set CSP_REPORT_ONLY=off (or false/0) to drop the
// report-only header and silence /csp-report — the kill switch for the cost
// contract (the endpoint logs to stdout / Cloud Run logs only).
export function isCspReportOnlyEnabled() {
  const v = process.env.CSP_REPORT_ONLY;
  return v !== 'off' && v !== 'false' && v !== '0';
}

// The Reporting API wants an absolute, potentially-trustworthy URL, so this
// returns one from the configured canonical host — or null when APP_HOST is
// unset, which is the whole point of the function.
//
// It deliberately does NOT fall back to the request's own Host header. That
// value is attacker-chosen, so reflecting it hands the caller a report-only
// policy aiming its violation reports at an origin of their choosing. In
// production the fallback was dead code (APP_HOST is set — it also drives the
// www canonicalization in server.js and the OAuth redirect URI), but any
// preview/tunnel/staging deployment that skips APP_HOST is a supported setup,
// and "safe only because an unrelated env var happens to be set" is not an
// invariant worth keeping. Fail closed instead. (#514)
//
// Losing the fallback costs nothing real: report-uri accepts a path-relative
// URL, so the legacy channel still works host-less. Only report-to /
// Reporting-Endpoints need an absolute URL, and those are omitted rather than
// pointed somewhere untrusted — on every deployment that actually collects this
// telemetry, APP_HOST is set and both channels are emitted as before.
function reportEndpointUrl() {
  return process.env.APP_HOST
    ? `https://${process.env.APP_HOST}${CSP_REPORT_PATH}`
    : null;
}

// Report-only now mirrors the enforcing policy and adds the violation-report
// routing. Since the enforcing policy is already strict, this is a telemetry
// channel: it surfaces (via /csp-report) anything the enforcing policy blocks,
// which is useful for catching a regression — a future inline script/handler
// added without a nonce — after the flip. Toggle off with CSP_REPORT_ONLY.
// `reportUrl` is null when no canonical host is configured (see
// reportEndpointUrl). report-uri still works then, because it accepts the
// path-relative form; report-to is dropped, since naming a `csp-endpoint` group
// we never declared in Reporting-Endpoints would just be a dangling reference.
function buildReportOnlyHeader(nonce, reportUrl) {
  const directives = {
    ...BASE_DIRECTIVES,
    'script-src': buildScriptSrc(nonce),
    'report-uri': [reportUrl ?? CSP_REPORT_PATH],
  };
  if (reportUrl) {
    directives['report-to'] = ['csp-endpoint'];
  }
  return serializeDirectives(directives);
}

// Strip CR/LF + other control chars (U+0000–U+001F and DEL U+007F) and bound
// length so a hostile report body can't forge extra log lines or blow up log
// volume. (CWE-117 — audit finding 3.)
//
// IMPORTANT: the class is NOT negated. We replace the control characters
// themselves with a space, leaving printable text intact. A negated class
// like /[^...]/ would do the opposite — blank the printable text and KEEP the
// newline — so the leading `^` must be absent. Write the range with explicit
// \u escapes, never raw control bytes, so this stays a reviewable text diff.
export const sanitizeLogField = (v) =>
  String(v ?? '?')
    // eslint-disable-next-line no-control-regex -- intentional: strip raw control bytes from attacker-influenced log fields (see note above)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .slice(0, 256);

// Pulls the few fields worth seeing out of either report shape — legacy
// application/csp-report ({ "csp-report": {...} }) or the Reporting API array
// ([{ body: {...} }]) — and writes one compact stdout line per violation.
// Fields are attacker-influenced (the endpoint is necessarily
// unauthenticated), so they are sanitized and the entry count is bounded.
export function logCspReport(body) {
  if (!body) return;
  const reports = Array.isArray(body) ? body : [body];
  for (const entry of reports.slice(0, 10)) {
    const r = entry['csp-report'] || entry.body || entry;
    const directive = sanitizeLogField(
      r['violated-directive'] || r.effectiveDirective,
    );
    const blocked = sanitizeLogField(r['blocked-uri'] || r.blockedURL);
    const doc = sanitizeLogField(r['document-uri'] || r.documentURL);
    Logger.warn(
      `[csp-report] directive=${directive} blocked=${blocked} doc=${doc}`,
    );
  }
}

export function securityHeaders(req, res, next) {
  const nonce = randomBytes(16).toString('base64');
  res.locals.cspNonce = nonce;

  res.setHeader('Content-Security-Policy', buildEnforcedHeader(nonce));
  if (isCspReportOnlyEnabled()) {
    const reportUrl = reportEndpointUrl();
    if (reportUrl) {
      res.setHeader('Reporting-Endpoints', `csp-endpoint="${reportUrl}"`);
    }
    res.setHeader(
      'Content-Security-Policy-Report-Only',
      buildReportOnlyHeader(nonce, reportUrl),
    );
  }
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains',
  );
  next();
}
