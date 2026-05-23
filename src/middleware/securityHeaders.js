// Replaces helmet: CSP, Referrer-Policy, X-Content-Type-Options, X-Frame-Options, HSTS.
const CSP_DIRECTIVES = {
  "default-src": ["'self'"],
  "script-src": [
    "'self'",
    "'unsafe-inline'",
    "https://www.googletagmanager.com",
    "https://ajax.googleapis.com",
    "https://cdn.jsdelivr.net",
  ],
  "style-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
  "img-src": ["'self'", "data:", "https:"],
  "connect-src": [
    "'self'",
    "https://www.google-analytics.com",
    "https://region1.google-analytics.com",
    "https://cdn.jsdelivr.net",
  ],
  "font-src": ["'self'", "https://cdn.jsdelivr.net"],
  "script-src-attr": ["'unsafe-inline'"],
  "frame-src": ["'none'"],
  "object-src": ["'none'"],
  "form-action": ["'self'", "https://accounts.google.com"],
};

const CSP_HEADER = Object.entries(CSP_DIRECTIVES)
  .map(([directive, values]) => `${directive} ${values.join(" ")}`)
  .join("; ");

export function securityHeaders(req, res, next) {
  res.setHeader("Content-Security-Policy", CSP_HEADER);
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}
