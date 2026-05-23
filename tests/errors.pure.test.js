import {
  ValidationError,
  DatabaseError,
  ServiceError,
  withErrorHandling,
  validateRequired,
  validateArray,
  validateNumber,
} from '../src/utils/errors.js';

describe('ValidationError', () => {
  test('sets name, message, and field', () => {
    const err = new ValidationError('bad input', 'email');
    expect(err.name).toBe('ValidationError');
    expect(err.message).toBe('bad input');
    expect(err.field).toBe('email');
    expect(err instanceof Error).toBe(true);
  });

  test('field defaults to null', () => {
    const err = new ValidationError('bad input');
    expect(err.field).toBeNull();
  });
});

describe('DatabaseError', () => {
  test('sets name, message, and operation', () => {
    const err = new DatabaseError('connection failed', 'getActiveGames');
    expect(err.name).toBe('DatabaseError');
    expect(err.message).toBe('connection failed');
    expect(err.operation).toBe('getActiveGames');
  });

  test('operation defaults to null', () => {
    const err = new DatabaseError('connection failed');
    expect(err.operation).toBeNull();
  });
});

describe('ServiceError', () => {
  test('sets name, message, and service', () => {
    const err = new ServiceError('something broke', 'pointsService');
    expect(err.name).toBe('ServiceError');
    expect(err.message).toBe('something broke');
    expect(err.service).toBe('pointsService');
  });

  test('service defaults to null', () => {
    const err = new ServiceError('something broke');
    expect(err.service).toBeNull();
  });
});

describe('withErrorHandling', () => {
  test('returns result on success', async () => {
    const fn = withErrorHandling(async () => 42);
    await expect(fn()).resolves.toBe(42);
  });

  test('passes args through to wrapped function', async () => {
    const fn = withErrorHandling(async (a, b) => a + b);
    await expect(fn(3, 4)).resolves.toBe(7);
  });

  test('re-throws ValidationError unchanged', async () => {
    const original = new ValidationError('bad', 'field');
    const fn = withErrorHandling(async () => { throw original; });
    await expect(fn()).rejects.toBe(original);
  });

  test('re-throws DatabaseError unchanged', async () => {
    const original = new DatabaseError('db down', 'read');
    const fn = withErrorHandling(async () => { throw original; });
    await expect(fn()).rejects.toBe(original);
  });

  test('re-throws ServiceError unchanged', async () => {
    const original = new ServiceError('svc err', 'myService');
    const fn = withErrorHandling(async () => { throw original; });
    await expect(fn()).rejects.toBe(original);
  });

  test('wraps unknown errors in ServiceError', async () => {
    const fn = withErrorHandling(async () => { throw new Error('unexpected'); }, 'myContext');
    const err = await fn().catch(e => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.message).toBe('unexpected');
    expect(err.service).toBe('myContext');
  });
});

describe('validateRequired', () => {
  test('throws for undefined', () => {
    expect(() => validateRequired(undefined, 'field')).toThrow(ValidationError);
  });

  test('throws for null', () => {
    expect(() => validateRequired(null, 'field')).toThrow(ValidationError);
  });

  test('throws for empty string', () => {
    expect(() => validateRequired('', 'field')).toThrow(ValidationError);
  });

  test('passes for 0', () => {
    expect(() => validateRequired(0, 'field')).not.toThrow();
  });

  test('passes for false', () => {
    expect(() => validateRequired(false, 'field')).not.toThrow();
  });

  test('passes for non-empty string', () => {
    expect(() => validateRequired('hello', 'field')).not.toThrow();
  });

  test('error field matches fieldName', () => {
    try {
      validateRequired(null, 'myField');
    } catch (e) {
      expect(e.field).toBe('myField');
    }
  });
});

describe('validateArray', () => {
  test('throws for non-array', () => {
    expect(() => validateArray('not-array', 'items')).toThrow(ValidationError);
  });

  test('throws for null (required check)', () => {
    expect(() => validateArray(null, 'items')).toThrow(ValidationError);
  });

  test('throws for undefined', () => {
    expect(() => validateArray(undefined, 'items')).toThrow(ValidationError);
  });

  test('passes for empty array', () => {
    expect(() => validateArray([], 'items')).not.toThrow();
  });

  test('passes for non-empty array', () => {
    expect(() => validateArray([1, 2, 3], 'items')).not.toThrow();
  });
});

describe('validateNumber', () => {
  test('returns the parsed number', () => {
    expect(validateNumber(5, 'count')).toBe(5);
  });

  test('parses string numbers', () => {
    expect(validateNumber('42', 'count')).toBe(42);
  });

  test('throws for NaN', () => {
    expect(() => validateNumber('abc', 'count')).toThrow(ValidationError);
  });

  test('throws when below min', () => {
    expect(() => validateNumber(0, 'count', 1)).toThrow(ValidationError);
  });

  test('passes when equal to min', () => {
    expect(() => validateNumber(1, 'count', 1)).not.toThrow();
  });

  test('throws when above max', () => {
    expect(() => validateNumber(101, 'count', null, 100)).toThrow(ValidationError);
  });

  test('passes when equal to max', () => {
    expect(() => validateNumber(100, 'count', null, 100)).not.toThrow();
  });

  test('passes with both min and max in range', () => {
    expect(validateNumber('50', 'count', 1, 100)).toBe(50);
  });
});
