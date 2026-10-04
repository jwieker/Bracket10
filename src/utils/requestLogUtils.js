import { ServiceError } from './errors.js';

// Only numeric routing/game metadata is useful in request-body logs. Validate
// the value too: an allowed field name is not proof that its contents are safe.
const NUMERIC_FIELDS = new Set(['year', 'gameYear', 'round', 'gameID']);
// Field names are diagnostic metadata, but arbitrary error.field values may
// contain input. Emit only known names, never a regex-approved arbitrary string.
const VALIDATION_FIELDS = new Set([
  ...NUMERIC_FIELDS,
  'email',
  'entryId',
  'name',
  'team',
  'Name',
  'Team name',
  'Email',
  'slug',
  'shortName',
  'division',
  'teamSIDs',
  'gameName',
]);

export function requestLogContext(req) {
  const body = {};
  for (const [key, value] of Object.entries(req.body || {})) {
    if (
      NUMERIC_FIELDS.has(key) &&
      ((typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= 0) ||
        (typeof value === 'string' && /^\d{1,15}$/.test(value)))
    ) {
      body[key] = value;
    }
  }
  return {
    method: req.method,
    url: (req.originalUrl || req.url || '').split(/[?#]/, 1)[0],
    body,
  };
}

// Request errors may contain a parser's raw body, an upstream request config,
// or input echoed in the message. Keep stack locations, never the error object.
export function requestErrorDetails(error) {
  const names = [
    'Error',
    'TypeError',
    'SyntaxError',
    'RangeError',
    'ValidationError',
    'ServiceError',
  ];
  const prefix = error?.message
    ? `${error?.name}: ${error.message}`
    : error?.name;
  // Remove the entire message, including embedded newlines that resemble frames.
  const frames =
    typeof error?.stack === 'string' && error.stack.startsWith(prefix)
      ? error.stack.slice(prefix.length)
      : '';
  return {
    name: names.includes(error?.name) ? error.name : 'Error',
    ...(error?.name === 'ValidationError' && VALIDATION_FIELDS.has(error.field)
      ? { field: error.field }
      : {}),
    ...(error instanceof ServiceError && typeof error.service === 'string'
      ? { service: error.service }
      : {}),
    stack: frames
      .split('\n')
      .filter((line) => /^\s+at /.test(line))
      .join('\n'),
  };
}
