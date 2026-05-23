# Security Policy

## Supported Versions

This project is a small self-hosted app, not a versioned library. Only the `main` branch of the public repository is supported. If you're running an older snapshot, please update to the latest commit before filing a security issue.

## Reporting a Vulnerability

**Please do not file public GitHub issues for security vulnerabilities.**

Report security issues privately via [GitHub's private vulnerability reporting](https://github.com/jwieker/bracket10/security/advisories/new) on the repository. This keeps the report confidential until a fix is ready.

If you cannot use the private advisory flow, email the maintainer listed under `author` in [`package.json`](./package.json) with:

- A description of the issue.
- Steps to reproduce (or a proof-of-concept).
- The affected file paths or routes.
- Your assessment of the impact.

You should expect an acknowledgement within **7 days**. We aim to ship a fix or a workaround within **30 days** of confirmation, depending on severity.

## Scope

In scope:

- Authentication and authorization bugs (`/admin`, `/my-entry`, OAuth flow).
- Injection vulnerabilities (XSS, SSRF, prototype pollution, template injection).
- Session handling issues (`express-session` / `FirestoreStore`).
- Privilege escalation in the public entry-edit flow.
- Sensitive data exposure (server-side logs, error responses, cache headers).
- CSRF or state-validation gaps in admin-only endpoints.

Out of scope:

- Reports against an unmodified default deployment that depend on the operator misconfiguring `ADMIN_EMAILS`, `SESSION_SECRET`, or GCP IAM. Misconfiguration is the operator's responsibility.
- Reports requiring physical or local access to the operator's machine.
- Denial-of-service that requires running the application without GCP rate limits or scale caps.
- Findings from automated scanners without a working PoC.

## Disclosure

After a fix lands, we will publish a brief GitHub Security Advisory crediting the reporter (unless anonymity is requested). No CVE will be requested unless the issue affects a wide range of deployments.

## Hardening Already in Place

The current security baseline is documented in [`docs/architecture/security.md`](./docs/architecture/security.md). Highlights:

- Google OAuth uses a session-backed `state` parameter and `audience`-validated ID tokens.
- `/my-entry/*` re-reads stored entries before writes; server-owned fields (`email`, `groups`, payment metadata) ignore form input.
- Production `DatabaseError` / `ServiceError` responses are generic; details only land in server logs.
- Session cookies use `httpOnly`, `sameSite: 'lax'`, and `secure` in production.
- Inline CSP and Referrer-Policy headers via `src/middleware/securityHeaders.js`.
- Custom fixed-window rate limiting via `src/middleware/rateLimit.js`.
- Sensitive request-body fields (`email`, `name`, `picks`, …) are redacted in controller start-logs.
