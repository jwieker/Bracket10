import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import Logger from '../src/utils/logger.js';

function parseLog(mockFn) {
  const raw = mockFn.mock.calls[0][0];
  return JSON.parse(raw);
}

describe('Logger structured output', () => {
  let spyLog, spyWarn, spyError;

  beforeEach(() => {
    spyLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    spyError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('info() emits severity INFO via console.log', () => {
    Logger.info('test info');
    expect(spyLog).toHaveBeenCalledOnce();
    const entry = parseLog(spyLog);
    expect(entry.severity).toBe('INFO');
    expect(entry.message).toBe('test info');
    expect(entry.timestamp).toBeDefined();
  });

  test('info() includes data field when provided', () => {
    Logger.info('with data', { count: 3 });
    const entry = parseLog(spyLog);
    expect(entry.data).toEqual({ count: 3 });
  });

  test('info() omits data field when null', () => {
    Logger.info('no data');
    const entry = parseLog(spyLog);
    expect('data' in entry).toBe(false);
  });

  test('warn() emits severity WARNING via console.warn', () => {
    Logger.warn('test warn');
    expect(spyWarn).toHaveBeenCalledOnce();
    const entry = parseLog(spyWarn);
    expect(entry.severity).toBe('WARNING');
    expect(entry.message).toBe('test warn');
  });

  test('error() emits severity ERROR via console.error', () => {
    Logger.error('test error');
    expect(spyError).toHaveBeenCalledOnce();
    const entry = parseLog(spyError);
    expect(entry.severity).toBe('ERROR');
    expect(entry.message).toBe('test error');
  });

  test('error() serializes Error objects to message+stack', () => {
    const err = new Error('boom');
    Logger.error('something broke', err);
    const entry = parseLog(spyError);
    expect(entry.data.message).toBe('boom');
    expect(typeof entry.data.stack).toBe('string');
  });

  test('error() passes non-Error data through', () => {
    Logger.error('bad state', { code: 500 });
    const entry = parseLog(spyError);
    expect(entry.data).toEqual({ code: 500 });
  });

  test('debug() fires in test environment (NODE_ENV=test)', () => {
    // NODE_ENV is 'test' when vitest runs
    Logger.debug('debug msg', { x: 1 });
    expect(spyLog).toHaveBeenCalledOnce();
    const entry = parseLog(spyLog);
    expect(entry.severity).toBe('DEBUG');
    expect(entry.data).toEqual({ x: 1 });
  });

  test('output is valid JSON', () => {
    Logger.info('json check', { nested: { a: 1 } });
    const raw = spyLog.mock.calls[0][0];
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  test('info() fires regardless of NODE_ENV (always-on)', () => {
    // This test verifies info/warn are not gated by environment
    // by confirming spyLog is called (it would not be in old silenced impl)
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    Logger.info('prod info');
    expect(spyLog).toHaveBeenCalledOnce();
    process.env.NODE_ENV = origEnv;
  });

  test('warn() fires regardless of NODE_ENV (always-on)', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    Logger.warn('prod warn');
    expect(spyWarn).toHaveBeenCalledOnce();
    process.env.NODE_ENV = origEnv;
  });
});
