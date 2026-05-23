import { retryOperation } from '../src/utils/dbUtils.js';

describe('retryOperation', () => {
  test('returns result on first attempt', async () => {
    const op = vi.fn().mockResolvedValue('success');
    const result = await retryOperation(op, 3, 100);
    expect(result).toBe('success');
    expect(op).toHaveBeenCalledTimes(1);
  });

  test('retries on failure and succeeds on third attempt', async () => {
    const op = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce('success');

    // Use very short delays so the test runs quickly
    const result = await retryOperation(op, 3, 1);
    expect(result).toBe('success');
    expect(op).toHaveBeenCalledTimes(3);
  }, 10000);

  test('throws after maxRetries exhausted', async () => {
    const error = new Error('always fails');
    const op = vi.fn().mockRejectedValue(error);

    await expect(retryOperation(op, 3, 1)).rejects.toBe(error);
    expect(op).toHaveBeenCalledTimes(3);
  }, 10000);

  test('applies exponential backoff — delay doubles each retry', async () => {
    const delays = [];

    // Spy on the Promise-based timer to capture delays
    vi.spyOn(global, 'setTimeout').mockImplementation((fn, delay) => {
      delays.push(delay);
      fn(); // execute immediately
      return 0;
    });

    const op = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce('done');

    await retryOperation(op, 3, 500);

    expect(delays[0]).toBe(500);
    expect(delays[1]).toBe(1000);

    vi.restoreAllMocks();
  });
});
