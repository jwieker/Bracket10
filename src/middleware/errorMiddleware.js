import Logger from '../utils/logger.js';
import {
  ValidationError,
  ServiceError,
  DatabaseError,
  debugErrorsEnabled,
} from '../utils/errors.js';

// Verbose error fields (operation, service, internal messages) are exposed only
// when DEBUG_ERRORS is explicitly enabled (see debugErrorsEnabled in errors.js —
// the single source of truth shared with controllerWrapper). Previously these
// leaked for any non-production NODE_ENV — but "non-prod" isn't the same as
// "safe to expose schema names and internal exception text". Opt-in via env
// keeps the default safe even in staging / preview environments.

// Global Express error handling middleware
export function errorMiddleware(err, req, res, next) {
  // If the response has already started streaming we can't set a new status or
  // body — doing so throws "Cannot set headers after they are sent". Hand off
  // to Express's default handler, which aborts the connection cleanly.
  if (res.headersSent) {
    return next(err);
  }

  try {
    const isJson =
      req.headers['accept'] &&
      req.headers['accept'].includes('application/json');

    // Map known error types to status codes and payloads
    if (err instanceof ValidationError) {
      Logger.warn(`Validation error at ${req.method} ${req.originalUrl}`, {
        field: err.field,
        message: err.message,
      });
      const payload = {
        error: 'Validation Error',
        message: err.message,
        field: err.field,
      };
      // err.message can echo raw query/body input (e.g. parseYear's "Invalid year: <raw>").
      // res.send() on a string defaults to text/html, which would render that input as
      // markup for any non-JSON caller — force text/plain so it's never interpreted as HTML.
      return isJson
        ? res.status(400).json(payload)
        : res.status(400).type('text/plain').send(payload.message);
    }

    if (err instanceof DatabaseError) {
      Logger.error(`Database error at ${req.method} ${req.originalUrl}`, err);
      const payload = debugErrorsEnabled()
        ? {
            error: 'Database Error',
            message: err.message,
            operation: err.operation,
          }
        : { error: 'Database Error', message: 'A database error occurred.' };
      return isJson
        ? res.status(500).json(payload)
        : res.status(500).type('text/plain').send('A database error occurred.');
    }

    if (err instanceof ServiceError) {
      Logger.error(`Service error at ${req.method} ${req.originalUrl}`, err);
      const payload = debugErrorsEnabled()
        ? { error: 'Service Error', message: err.message, service: err.service }
        : { error: 'Service Error', message: 'A service error occurred.' };
      return isJson
        ? res.status(500).json(payload)
        : res.status(500).type('text/plain').send('A service error occurred.');
    }

    // Unknown error
    Logger.error(`Unhandled error at ${req.method} ${req.originalUrl}`, err);
    const payload = {
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    };
    return isJson
      ? res.status(500).json(payload)
      : res.status(500).type('text/plain').send(payload.message);
  } catch (middlewareError) {
    // Last resort: ensure the response is sent
    Logger.error('Error in errorMiddleware:', middlewareError);
    return res.status(500).send('Internal Server Error');
  }
}
