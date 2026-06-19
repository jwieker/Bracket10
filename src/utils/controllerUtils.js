import Logger from './logger.js';
import { ValidationError, ServiceError, debugErrorsEnabled } from './errors.js';

const SENSITIVE_KEYS = new Set([
  'email', 'password', 'name', 'team', 'teamName', 'person',
  'picks', 'maxPoints', 'entryId',
]);

function redactBody(body) {
  if (!body || typeof body !== 'object') return body;
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = SENSITIVE_KEYS.has(k) ? '[redacted]' : (typeof v === 'string' && v.length > 200 ? '[long]' : v);
  }
  return out;
}

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
            Logger.info(`${operationName} started`, {
                method: req.method,
                url: req.url,
                bodyKeys: req.body ? Object.keys(req.body) : [],
                body: redactBody(req.body),
            });

            const result = await controllerFunction(req, res);

            const duration = Date.now() - startTime;
            Logger.performance(`${operationName} completed`, duration);

            return result;
        } catch (error) {
            const duration = Date.now() - startTime;
            Logger.error(`${operationName} failed after ${duration}ms`, error);

            // Handle different error types
            if (error instanceof ValidationError) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: error.message,
                    field: error.field
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
                message: 'An unexpected error occurred'
            });
        }
    };
};

// Standardized success response
export const successResponse = (res, data, message = 'Success') => {
    return res.status(200).json({
        success: true,
        message,
        data
    });
};

// Standardized error response
export const errorResponse = (res, statusCode, message, details = null) => {
    const response = {
        success: false,
        message
    };

    if (details) {
        response.details = details;
    }

    return res.status(statusCode).json(response);
};

// Request validation helper
export const validateRequest = (req, requiredFields = []) => {
    const missingFields = requiredFields.filter(field =>
        req.body[field] === undefined || req.body[field] === null || req.body[field] === ''
    );

    if (missingFields.length > 0) {
        throw new ValidationError(
            `Missing required fields: ${missingFields.join(', ')}`,
            missingFields
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
      'year'
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
  if ((raw === undefined || raw === null || raw === '') && defaultValue !== undefined) {
    return defaultValue;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ValidationError(`${fieldName} must be a positive integer (got: ${raw})`, fieldName);
  }
  if (max !== undefined && n > max) {
    throw new ValidationError(`${fieldName} must not exceed ${max} (got: ${n})`, fieldName);
  }
  return n;
}

// Conference payload validator (V2). Validates slug shape and name length.
const SLUG_RE = /^[a-z0-9-]+$/;
export function validateConferencePayload({ slug, name, shortName, division }) {
  if (!slug || typeof slug !== 'string' || slug.length === 0 || slug.length > 64) {
    throw new ValidationError('slug is required and must be 1-64 chars', 'slug');
  }
  if (!SLUG_RE.test(slug)) {
    throw new ValidationError('slug may only contain lowercase letters, digits, and hyphens', 'slug');
  }
  if (!name || typeof name !== 'string' || name.length === 0 || name.length > 128) {
    throw new ValidationError('name is required and must be 1-128 chars', 'name');
  }
  if (shortName !== undefined && shortName !== null && shortName !== '' && (typeof shortName !== 'string' || shortName.length > 64)) {
    throw new ValidationError('shortName must be a string of at most 64 chars', 'shortName');
  }
  if (division !== undefined && division !== null && division !== '' && (typeof division !== 'string' || division.length > 16)) {
    throw new ValidationError('division must be a string of at most 16 chars', 'division');
  }
}

// Session promisification helpers
export const saveSession = (req) => {
  return new Promise((resolve, reject) => {
    req.session.save((err) => err ? reject(err) : resolve());
  });
};

export const regenerateSession = (req) => {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => err ? reject(err) : resolve());
  });
};
