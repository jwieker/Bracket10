import Logger from './logger.js';
import { ValidationError, ServiceError, debugErrorsEnabled } from './errors.js';

import { requestLogContext, requestErrorDetails } from './requestLogUtils.js';

// Standardized controller response wrapper.
//
// Mirrors errorMiddleware's error-disclosure policy: the internal `service`
// name and raw service-error message are exposed only under DEBUG_ERRORS.
// Previously this catch block returned `service` (and the raw message)
// unconditionally, silently leaking internal service names in production even
// though errorMiddleware hid them — this closes that bypass (#168). The
// non-sensitive `field` on a ValidationError is still returned (matching
// errorMiddleware) so clients learn which input was invalid.
export const controllerWrapper = (controllerFunction, operationName = '') => {
  return async (req, res) => {
    const startTime = Date.now();

    try {
      Logger.info(`${operationName} started`, requestLogContext(req));

      const result = await controllerFunction(req, res);

      const duration = Date.now() - startTime;
      Logger.performance(`${operationName} completed`, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      Logger.error(`${operationName} failed after ${duration}ms`, {
        ...requestLogContext(req),
        ...requestErrorDetails(error),
      });

      // Handle different error types
      if (error instanceof ValidationError) {
        return res.status(400).json({
          error: 'Validation Error',
          message: error.message,
          field: error.field,
        });
      }

      if (error instanceof ServiceError) {
        const verbose = debugErrorsEnabled();
        return res.status(500).json({
          error: 'Service Error',
          message: verbose ? error.message : 'A service error occurred.',
          ...(verbose && { service: error.service }),
        });
      }

      // Generic error response
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
      });
    }
  };
};

// Standardized success response
export const successResponse = (res, data, message = 'Success') => {
  return res.status(200).json({
    success: true,
    message,
    data,
  });
};

// Standardized error response
export const errorResponse = (res, statusCode, message, details = null) => {
  const response = {
    success: false,
    message,
  };

  if (details) {
    response.details = details;
  }

  return res.status(statusCode).json(response);
};

// Request validation helper
export const validateRequest = (req, requiredFields = []) => {
  const missingFields = requiredFields.filter(
    (field) =>
      req.body[field] === undefined ||
      req.body[field] === null ||
      req.body[field] === '',
  );

  if (missingFields.length > 0) {
    throw new ValidationError(
      `Missing required fields: ${missingFields.join(', ')}`,
      missingFields,
    );
  }
};

// Year validation helper — throws ValidationError on invalid input
export function parseYear(raw) {
  const n = Number(raw);
  const currentYear = new Date().getFullYear();
  if (!Number.isInteger(n) || n < 1980 || n > currentYear + 1) {
    throw new ValidationError(
      `Invalid year: ${raw}. Must be between 1980 and ${currentYear + 1}.`,
      'year',
    );
  }
  return n;
}

// Like parseYear but returns `defaultYear` when the input is null/undefined/empty.
// Replaces the `Number(req.query.year) || thisYear` pattern that silently
// swallowed NaN, negatives, zero, and Infinity.
export function parseYearOrDefault(raw, defaultYear) {
  if (raw === undefined || raw === null || raw === '') return defaultYear;
  return parseYear(raw);
}

// Positive integer validator. Throws ValidationError on bad input. When `raw`
// is missing and `defaultValue` is provided, returns the default instead of throwing.
export function parsePositiveInt(raw, fieldName, { defaultValue, max } = {}) {
  if (
    (raw === undefined || raw === null || raw === '') &&
    defaultValue !== undefined
  ) {
    return defaultValue;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ValidationError(
      `${fieldName} must be a positive integer (got: ${raw})`,
      fieldName,
    );
  }
  if (max !== undefined && n > max) {
    throw new ValidationError(
      `${fieldName} must not exceed ${max} (got: ${n})`,
      fieldName,
    );
  }
  return n;
}

// Entry ids are always the digit-string form of the Number generateUniqueEntryId
// (viewService.js) produces (12-15 digits, well within this bound) — never
// containing '/'. Enforcing that shape before any Firestore lookup closes off
// a crafted id like "x/schoolRecords/y" from being read by the Firestore SDK
// as alternating collection/document path segments (yearDoc() does
// `.doc(String(entryId))`, and Firestore treats '/' in a doc path as a path
// separator) (#335).
const ENTRY_ID_RE = /^[0-9]{1,20}$/;
export function validateEntryId(entryId) {
  if (typeof entryId !== 'string' || !ENTRY_ID_RE.test(entryId)) {
    throw new ValidationError('Invalid entry ID.', 'entryId');
  }
}

// Participant-supplied free-text fields (`name`, `team`, `email`) on the entry
// create and update paths. A truthiness check is not a type check: server.js
// mounts express.urlencoded({ extended: true }), so a repeated key
// (`team=a&team=b` or `team[]=a`) parses to an *array* — truthy, but `.trim` is
// not a function on it, so the guard meant to say "this field is wrong" threw a
// TypeError and the caller got a 500 (#549). Absent the field entirely,
// `undefined` reached ref.update() and the Firestore SDK rejected it (no
// ignoreUndefinedProperties in src/config/firestore.js) — the other 500 (#548).
//
// The cap exists because `teamName`/`person` are participant-writable and
// rendered on the public results page and full grid for every visitor of the
// group, with no bound on what could be stored. 128 is deliberately the same
// number extractPicks already caps a team name at (entryPicksUtils.js) — create
// and update enforcing different rules on the same field is how this drifted.
export const MAX_ENTRY_TEXT_LEN = 128;
// Email gets a bound too, but not 128: RFC 5321 caps an address at 254, and
// `email` isn't the publicly-rendered field the tighter cap exists to protect,
// so reusing 128 here would reject legitimate (if unusual) addresses.
export const MAX_EMAIL_LEN = 254;

export function validateEntryTextField(value, fieldName, maxLen) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${fieldName} is required.`, fieldName);
  }
  if (value.length > maxLen) {
    throw new ValidationError(
      `${fieldName} must be at most ${maxLen} characters.`,
      fieldName,
    );
  }
  return value.trim();
}

// Conference payload validator (V2). Validates slug shape and name length.
const SLUG_RE = /^[a-z0-9-]+$/;

// Same shape rule as validateConferencePayload's slug half, in predicate form
// for read paths that answer with a plain-text 400 rather than throwing (#512).
// Read paths need it for the same reason writes do: getConferenceBySlug does
// `.doc(slug)`, and Firestore reads '/' in a document path as a path separator,
// so an unvalidated `?slug=x/y/z` addresses a doc two subcollections deep
// instead of the intended conference. Deliberately shares SLUG_RE with the
// write validator — the drift between a validated write and an unvalidated
// read is exactly what this closes, so a second copy of the regex would
// reintroduce it.
export function isValidSlug(slug) {
  return (
    typeof slug === 'string' &&
    slug.length > 0 &&
    slug.length <= 64 &&
    SLUG_RE.test(slug)
  );
}

export function validateConferencePayload({ slug, name, shortName, division }) {
  if (
    !slug ||
    typeof slug !== 'string' ||
    slug.length === 0 ||
    slug.length > 64
  ) {
    throw new ValidationError(
      'slug is required and must be 1-64 chars',
      'slug',
    );
  }
  if (!SLUG_RE.test(slug)) {
    throw new ValidationError(
      'slug may only contain lowercase letters, digits, and hyphens',
      'slug',
    );
  }
  if (
    !name ||
    typeof name !== 'string' ||
    name.length === 0 ||
    name.length > 128
  ) {
    throw new ValidationError(
      'name is required and must be 1-128 chars',
      'name',
    );
  }
  if (
    shortName !== undefined &&
    shortName !== null &&
    shortName !== '' &&
    (typeof shortName !== 'string' || shortName.length > 64)
  ) {
    throw new ValidationError(
      'shortName must be a string of at most 64 chars',
      'shortName',
    );
  }
  if (
    division !== undefined &&
    division !== null &&
    division !== '' &&
    (typeof division !== 'string' || division.length > 16)
  ) {
    throw new ValidationError(
      'division must be a string of at most 16 chars',
      'division',
    );
  }
}

// Session promisification helpers
export const saveSession = (req) => {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
};

export const regenerateSession = (req) => {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
};

export const destroySession = (req) => {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
};

export function homeErrorRedirect(query) {
  return `/?${query}`;
}
