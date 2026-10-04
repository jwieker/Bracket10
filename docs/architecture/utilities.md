---
tags: [architecture, utilities, errors, logging]
updated: 2026-09-18
---

# Utilities & Error Handling

These utilities in `src/utils/` are central to the architecture and **must** be used consistently.

## `controllerUtils.js` — Controller Wrapper & Responses

- **`controllerWrapper(fn, operationName)`**: Standard controller wrapper. Logs start/end, measures performance, maps `ValidationError` → 400, `ServiceError` → 500. Always use for new controllers. Both OAuth handlers in `pointsController.js` are wrapped.
- **`successResponse(res, data, message)`**: Standard JSON success response shape.
- **`errorResponse(res, statusCode, message)`**: Standard JSON error response shape.
- **`validateRequest(req, fields[])`**: Throws a `ValidationError` if required body fields are missing.
- **`parseYear(raw)`**: Validates a year integer (1980 ≤ year ≤ currentYear+1). Throws `ValidationError` on invalid input. Use for any required `year` parameter from `req.body`/`req.query`.
- **`parseYearOrDefault(raw, defaultYear)`**: Same as `parseYear` but returns `defaultYear` when `raw` is missing/empty. Replaces the legacy `Number(req.query.year) || thisYear` pattern, which silently accepted NaN, negatives, and Infinity.
  - **Repository backstop:** `yearCol` in `hierarchicalRepository.js` also throws `ValidationError` on a `NaN` year (#477). `String(NaN)` is the valid path segment `"NaN"`, so an unparsed year used to build a real, permanently-empty `tournaments/NaN/{sub}` ref — reads returned `[]` and callers reported "nothing here" instead of failing. The backstop makes an empty result mean empty, not misaddressed. It is a safety net, not a substitute: parse at the controller so the error names the right field.
- **`parsePositiveInt(raw, fieldName, { defaultValue, max })`**: Validates a positive integer with optional default and upper bound. Use for any numeric input where zero/negative is invalid (counts, IDs, etc.). Example: `parsePositiveInt(req.body.firstFourCount, 'firstFourCount', { defaultValue: 4, max: 8 })`.
- **`validateConferencePayload({ slug, name, shortName, division })`**: Shape validator for the conference admin forms. Enforces slug character set (`[a-z0-9-]`), length caps, and required fields. Throws `ValidationError` on any violation.
- **`saveSession(req)`** / **`regenerateSession(req)`**: Promise wrappers around the callback-based `req.session.save()` / `req.session.regenerate()`. Use these at every privilege transition (e.g. `await regenerateSession(req)` before setting `siteAdmin`/`verifiedEntries`, then `await saveSession(req)`) instead of hand-rolling `new Promise()`. See the Session Lifecycle section in `docs/architecture/security.md`.

```javascript
export const createEntry = controllerWrapper(async (req, res) => {
  validateRequest(req, ['name', 'year']); // throws ValidationError if missing
  const entry = await createNewEntry(req.body.name, req.body.year);
  return successResponse(res, entry, 'Entry created successfully');
}, 'createEntry');
```

## `errors.js` — Custom Error Classes

Two custom error classes:

| Class | HTTP Status | Extra Property | When to Use |
|---|---|---|---|
| `ValidationError` | 400 | `field` | User input fails validation |
| `ServiceError` | 500 | `service` | Business logic failure |

- **`withErrorHandling(fn, context)`**: Wraps an async function to catch errors, log them via `Logger`, and re-throw as `ServiceError` if untyped.

```javascript
export const getTournamentData = withErrorHandling(async (tournamentId) => {
  const data = await tournamentRepository.findById(tournamentId);
  if (!data) throw new ServiceError('Tournament not found', 'getTournamentData');
  return data;
}, 'getTournamentData');
```

Global error middleware in `errorMiddleware.js` maps errors to status codes and returns consistent responses. Production payloads are generic; request-boundary logs retain error types and stack locations without raw messages or arbitrary error-object properties.

## PII Redaction in Request Logs

`requestLogUtils.js` supplies shared log metadata for `controllerWrapper` and the global error middleware. Request URLs omit query strings and fragments. Body logs allow only `year`, `gameYear`, `round`, and `gameID`, with nonnegative safe-integer values or digit strings of at most 15 characters. All other fields and field names are omitted, including CSRF tokens, payment notes, emails, picks, and nested objects. New request fields are excluded by default; expand the allowlist only for non-sensitive metadata with strict value validation.

Request-boundary error logs keep the error type, recognized stack locations, and validation field names from a fixed allowlist. They also retain string `service` values from `ServiceError` instances. These fields must contain developer-authored diagnostic context, never request input. A plain error or object with a matching `name` does not qualify. Unknown field names and nonstandard stack formats are omitted. They omit messages (which may echo input), raw parser bodies, upstream request configuration, and arbitrary error properties. This deliberately sacrifices raw error text at these boundaries to avoid retaining authentication material. Other service/repository logs still require care when logging external data.

For existing logs, review Cloud Logging access and retention and remove historical sensitive entries according to the deployment's retention policy. A code change does not erase previously stored logs; no production log access or retention changes are made by this fix.

## `logger.js` — Structured Logger

Provides `Logger.info(...)`, `Logger.warn(...)`, `Logger.error(...)`, `Logger.debug(...)`, `Logger.performance(...)`.

**Always use Logger** instead of bare `console.log/warn/error` in service and repository code.

| Method | Fires in |
|---|---|
| `Logger.error(...)` | All environments (including production) |
| `Logger.debug(...)`, `Logger.warn(...)` | `development` and `test` only |
| `Logger.info(...)`, `Logger.performance(...)` | `development` only |

To see verbose `[DEBUG] DB CALL: ...` logs locally:
```bash
export NODE_ENV=development && npm run dev
```

