---
tags: [architecture, utilities, errors, logging]
updated: 2026-06-09
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

Three custom error classes:

| Class | HTTP Status | Extra Property | When to Use |
|---|---|---|---|
| `ValidationError` | 400 | `field` | User input fails validation |
| `DatabaseError` | 500 | `operation` | Firestore operation fails |
| `ServiceError` | 500 | `service` | Business logic failure |

- **`withErrorHandling(fn, context)`**: Wraps an async function to catch errors, log them via `Logger`, and re-throw as `ServiceError` if untyped.

```javascript
export const getTournamentData = withErrorHandling(async (tournamentId) => {
  const data = await tournamentRepository.findById(tournamentId);
  if (!data) throw new DatabaseError('Tournament not found', 'findById');
  return data;
}, 'getTournamentData');
```

Global error middleware in `errorMiddleware.js` maps errors to status codes and returns consistent responses. Production payloads are generic; full detail goes to `Logger.error`.

## PII Redaction in Request Logs

`controllerUtils.js` defines `SENSITIVE_KEYS` (email, name, picks, entryId, etc.) and `redactBody()`. The `controllerWrapper` start-log calls `redactBody(req.body)` so PII never reaches Cloud Logging. Values for sensitive keys appear as `[redacted]`; the `bodyKeys` field still shows key names for shape debugging. If you add a new field that carries PII, add it to `SENSITIVE_KEYS`.

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

