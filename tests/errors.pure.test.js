import {
  ValidationError,
  DatabaseError,
  ServiceError,
  withErrorHandling,
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
