import {
  controllerWrapper,
  successResponse,
  errorResponse,
  validateRequest,
  parseYear,
  parseYearOrDefault,
  parsePositiveInt,
  validateConferencePayload,
  validateEntryId,
} from '../src/utils/controllerUtils.js';
import { ValidationError, ServiceError } from '../src/utils/errors.js';

function mockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res;
}

function mockReq(overrides = {}) {
  return {
    body: {},
    query: {},
    params: {},
    method: 'GET',
    url: '/test',
    ...overrides,
  };
}

describe('successResponse', () => {
  test('returns 200 with success shape', () => {
    const res = mockRes();
    successResponse(res, { id: 1 }, 'Done');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Done',
      data: { id: 1 },
    });
  });

  test('uses default message "Success"', () => {
    const res = mockRes();
    successResponse(res, null);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Success' }),
    );
  });
});

describe('errorResponse', () => {
  test('returns correct status and shape', () => {
    const res = mockRes();
    errorResponse(res, 404, 'Not found');
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Not found',
    });
  });

  test('includes details when provided', () => {
    const res = mockRes();
    errorResponse(res, 400, 'Bad input', { field: 'email' });
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Bad input',
      details: { field: 'email' },
    });
  });

  test('omits details when not provided', () => {
    const res = mockRes();
    errorResponse(res, 500, 'Error');
    const call = res.json.mock.calls[0][0];
    expect(call.details).toBeUndefined();
  });
});

describe('validateRequest', () => {
  test('throws ValidationError for missing field', () => {
    const req = mockReq({ body: {} });
    expect(() => validateRequest(req, ['name'])).toThrow(ValidationError);
  });

  test('throws for null field value', () => {
    const req = mockReq({ body: { name: null } });
    expect(() => validateRequest(req, ['name'])).toThrow(ValidationError);
  });

  test('throws for empty string field', () => {
    const req = mockReq({ body: { name: '' } });
    expect(() => validateRequest(req, ['name'])).toThrow(ValidationError);
  });

  test('passes when all fields are present', () => {
    const req = mockReq({ body: { name: 'Alex', year: 2024 } });
    expect(() => validateRequest(req, ['name', 'year'])).not.toThrow();
  });

  test('passes with empty required fields list', () => {
    const req = mockReq();
    expect(() => validateRequest(req, [])).not.toThrow();
  });
});

describe('parseYear', () => {
  test('returns a valid year as a number', () => {
    expect(parseYear('2024')).toBe(2024);
    expect(parseYear('1980')).toBe(1980);
    expect(parseYear(2025)).toBe(2025);
  });

  test('throws ValidationError for non-numeric input', () => {
    expect(() => parseYear('abc')).toThrow(ValidationError);
    expect(() => parseYear('')).toThrow(ValidationError);
    expect(() => parseYear(null)).toThrow(ValidationError);
  });

  test('throws ValidationError for year below 1980', () => {
    expect(() => parseYear('1979')).toThrow(ValidationError);
    expect(() => parseYear('-1')).toThrow(ValidationError);
  });

  test('throws ValidationError for year more than 1 year in the future', () => {
    const tooFar = new Date().getFullYear() + 2;
    expect(() => parseYear(String(tooFar))).toThrow(ValidationError);
  });

  test('allows year equal to currentYear + 1', () => {
    const nextYear = new Date().getFullYear() + 1;
    expect(parseYear(String(nextYear))).toBe(nextYear);
  });

  test('throws ValidationError for floats', () => {
    expect(() => parseYear('2024.5')).toThrow(ValidationError);
  });
});

describe('parseYearOrDefault', () => {
  test('returns the default when raw is undefined/null/empty', () => {
    expect(parseYearOrDefault(undefined, 2024)).toBe(2024);
    expect(parseYearOrDefault(null, 2024)).toBe(2024);
    expect(parseYearOrDefault('', 2024)).toBe(2024);
  });

  test('returns parsed year when raw is a valid year', () => {
    expect(parseYearOrDefault('2023', 2024)).toBe(2023);
    expect(parseYearOrDefault(2025, 2024)).toBe(2025);
  });

  test('throws ValidationError when raw is present but invalid (does not fall through to default)', () => {
    // This is the V1 regression: the old `Number(x) || default` pattern silently
    // accepted NaN/negatives by falling through to the default. The new validator
    // must surface bad input rather than masking it.
    expect(() => parseYearOrDefault('not-a-year', 2024)).toThrow(
      ValidationError,
    );
    expect(() => parseYearOrDefault('-5', 2024)).toThrow(ValidationError);
    expect(() => parseYearOrDefault('99999', 2024)).toThrow(ValidationError);
  });
});

describe('parsePositiveInt', () => {
  test('returns parsed value for valid positive integers', () => {
    expect(parsePositiveInt('4', 'count')).toBe(4);
    expect(parsePositiveInt(7, 'count')).toBe(7);
  });

  test('throws ValidationError for zero, negatives, NaN, floats', () => {
    expect(() => parsePositiveInt('0', 'count')).toThrow(ValidationError);
    expect(() => parsePositiveInt('-1', 'count')).toThrow(ValidationError);
    expect(() => parsePositiveInt('abc', 'count')).toThrow(ValidationError);
    expect(() => parsePositiveInt('1.5', 'count')).toThrow(ValidationError);
  });

  test('returns defaultValue when raw is missing AND defaultValue is provided', () => {
    expect(parsePositiveInt(undefined, 'count', { defaultValue: 4 })).toBe(4);
    expect(parsePositiveInt('', 'count', { defaultValue: 4 })).toBe(4);
  });

  test('throws ValidationError when raw is missing and no default is provided', () => {
    expect(() => parsePositiveInt(undefined, 'count')).toThrow(ValidationError);
  });

  test('enforces max bound when supplied', () => {
    expect(() => parsePositiveInt('9', 'count', { max: 8 })).toThrow(
      ValidationError,
    );
    expect(parsePositiveInt('8', 'count', { max: 8 })).toBe(8);
  });
});

describe('validateEntryId', () => {
  test('accepts digit strings from 1 to 20 digits', () => {
    expect(() => validateEntryId('1')).not.toThrow();
    expect(() => validateEntryId('123456789012345')).not.toThrow(); // 15 digits, generateUniqueEntryId's real max
    expect(() => validateEntryId('1'.repeat(20))).not.toThrow(); // upper bound
  });

  test('rejects a path-shaped id (#335)', () => {
    expect(() => validateEntryId('x/schoolRecords/y')).toThrow(ValidationError);
  });

  test('rejects an empty string', () => {
    expect(() => validateEntryId('')).toThrow(ValidationError);
  });

  test('rejects a 21+ digit numeric string', () => {
    expect(() => validateEntryId('1'.repeat(21))).toThrow(ValidationError);
  });

  test('rejects non-string input, e.g. an array from a repeated query param (?entryId=1&entryId=2)', () => {
    expect(() => validateEntryId(['1', '2'])).toThrow(ValidationError);
    expect(() => validateEntryId(123)).toThrow(ValidationError);
    expect(() => validateEntryId(undefined)).toThrow(ValidationError);
    expect(() => validateEntryId(null)).toThrow(ValidationError);
  });
});

describe('validateConferencePayload', () => {
  test('accepts a well-formed payload', () => {
    expect(() =>
      validateConferencePayload({
        slug: 'acc',
        name: 'Atlantic Coast Conference',
        shortName: 'ACC',
        division: 'I',
      }),
    ).not.toThrow();
  });

  test('rejects empty or missing slug', () => {
    expect(() => validateConferencePayload({ slug: '', name: 'X' })).toThrow(
      ValidationError,
    );
    expect(() => validateConferencePayload({ name: 'X' })).toThrow(
      ValidationError,
    );
  });

  test('rejects slug with disallowed characters (uppercase, spaces, punctuation)', () => {
    expect(() =>
      validateConferencePayload({ slug: 'Big-12', name: 'Big 12' }),
    ).toThrow(ValidationError);
    expect(() =>
      validateConferencePayload({ slug: 'big 12', name: 'Big 12' }),
    ).toThrow(ValidationError);
    expect(() =>
      validateConferencePayload({ slug: 'big.12', name: 'Big 12' }),
    ).toThrow(ValidationError);
  });

  test('rejects slug longer than 64 chars', () => {
    expect(() =>
      validateConferencePayload({ slug: 'a'.repeat(65), name: 'X' }),
    ).toThrow(ValidationError);
  });

  test('rejects empty or oversized name', () => {
    expect(() => validateConferencePayload({ slug: 'acc', name: '' })).toThrow(
      ValidationError,
    );
    expect(() =>
      validateConferencePayload({ slug: 'acc', name: 'a'.repeat(129) }),
    ).toThrow(ValidationError);
  });

  test('allows shortName and division to be omitted', () => {
    expect(() =>
      validateConferencePayload({ slug: 'acc', name: 'Atlantic' }),
    ).not.toThrow();
  });
});

describe('controllerWrapper', () => {
  const prevDebug = process.env.DEBUG_ERRORS;
  afterEach(() => {
    if (prevDebug === undefined) delete process.env.DEBUG_ERRORS;
    else process.env.DEBUG_ERRORS = prevDebug;
  });

  test('calls inner function and returns result', async () => {
    const res = mockRes();
    const req = mockReq();
    const inner = vi.fn().mockResolvedValue('ok');
    const wrapped = controllerWrapper(inner, 'testOp');
    await wrapped(req, res);
    expect(inner).toHaveBeenCalledWith(req, res);
  });

  test('returns 400 json for ValidationError (field is non-sensitive, kept)', async () => {
    const res = mockRes();
    const req = mockReq();
    const inner = vi
      .fn()
      .mockRejectedValue(new ValidationError('bad field', 'email'));
    const wrapped = controllerWrapper(inner);
    await wrapped(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Validation Error',
        message: 'bad field',
        field: 'email',
      }),
    );
  });

  // #168 regression: the internal `service` name and raw message must NOT be
  // disclosed by default (production / no DEBUG_ERRORS) — matching
  // errorMiddleware's gate. Previously they leaked unconditionally.
  test('returns 500 json for ServiceError WITHOUT leaking service/raw message by default', async () => {
    delete process.env.DEBUG_ERRORS;
    const res = mockRes();
    const req = mockReq();
    const inner = vi
      .fn()
      .mockRejectedValue(new ServiceError('svc down', 'myService'));
    const wrapped = controllerWrapper(inner);
    await wrapped(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    const payload = res.json.mock.calls[0][0];
    expect(payload).not.toHaveProperty('service');
    expect(payload).toEqual({
      error: 'Service Error',
      message: 'A service error occurred.',
    });
  });

  test('returns 500 json for ServiceError WITH verbose fields when DEBUG_ERRORS=1', async () => {
    process.env.DEBUG_ERRORS = '1';
    const res = mockRes();
    const req = mockReq();
    const inner = vi
      .fn()
      .mockRejectedValue(new ServiceError('svc down', 'myService'));
    const wrapped = controllerWrapper(inner);
    await wrapped(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Service Error',
        message: 'svc down',
        service: 'myService',
      }),
    );
  });

  test('returns 500 json for unknown error', async () => {
    const res = mockRes();
    const req = mockReq();
    const inner = vi.fn().mockRejectedValue(new Error('unexpected'));
    const wrapped = controllerWrapper(inner);
    await wrapped(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Internal Server Error',
      }),
    );
  });
});
