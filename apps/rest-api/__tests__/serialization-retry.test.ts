import { describe, expect, it, vi } from 'vitest';

import {
  isSerializationFailure,
  withSerializationRetry,
} from '../src/utils/serialization-retry.js';

function makeSerializationError(): Error & { code: string } {
  return Object.assign(new Error('could not serialize access'), {
    code: '40001',
  });
}

/** Simulates how Drizzle wraps pg errors in DrizzleQueryError */
function makeDrizzleWrappedError(): Error {
  const pgError = makeSerializationError();
  const drizzleError = new Error(
    `Failed query: INSERT INTO agent_vouchers ...\nparams: [...]`,
  );
  drizzleError.cause = pgError;
  return drizzleError;
}

describe('withSerializationRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withSerializationRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on serialization failure and returns on success', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeSerializationError())
      .mockResolvedValueOnce('ok');

    const result = await withSerializationRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws ProblemError with 429 after max retries exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(makeSerializationError());

    try {
      await withSerializationRetry(fn, { maxRetries: 3 });
      expect.unreachable('should have thrown');
    } catch (error: unknown) {
      const err = error as Error & { statusCode: number; code: string };
      expect(err.statusCode).toBe(429);
      expect(err.code).toBe('SERIALIZATION_EXHAUSTED');
      expect(fn).toHaveBeenCalledTimes(3);
    }
  });

  it('does not retry non-serialization errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('connection refused'));

    await expect(withSerializationRetry(fn)).rejects.toThrow(
      'connection refused',
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calls onRetry callback with attempt number', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeSerializationError())
      .mockRejectedValueOnce(makeSerializationError())
      .mockResolvedValueOnce('ok');

    const onRetry = vi.fn();
    await withSerializationRetry(fn, { maxRetries: 5, onRetry });

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(1, 5);
    expect(onRetry).toHaveBeenCalledWith(2, 5);
  });

  it('applies jitter delay between retries', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeSerializationError())
      .mockResolvedValueOnce('ok');

    const start = Date.now();
    await withSerializationRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 10,
    });
    const elapsed = Date.now() - start;

    // Should have waited at least ~5ms (baseDelayMs * 0.5 jitter floor)
    expect(elapsed).toBeGreaterThanOrEqual(5);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('respects custom maxRetries', async () => {
    const fn = vi.fn().mockRejectedValue(makeSerializationError());

    await expect(
      withSerializationRetry(fn, { maxRetries: 7 }),
    ).rejects.toMatchObject({ code: 'SERIALIZATION_EXHAUSTED' });
    expect(fn).toHaveBeenCalledTimes(7);
  });

  it('retries when Drizzle wraps the pg error in cause chain', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeDrizzleWrappedError())
      .mockResolvedValueOnce('ok');

    const result = await withSerializationRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('returns 429 when Drizzle-wrapped errors exhaust retries', async () => {
    const fn = vi.fn().mockRejectedValue(makeDrizzleWrappedError());

    try {
      await withSerializationRetry(fn, { maxRetries: 3 });
      expect.unreachable('should have thrown');
    } catch (error: unknown) {
      const err = error as Error & { statusCode: number; code: string };
      expect(err.statusCode).toBe(429);
      expect(err.code).toBe('SERIALIZATION_EXHAUSTED');
      expect(fn).toHaveBeenCalledTimes(3);
    }
  });
});

describe('isSerializationFailure', () => {
  it('detects direct pg error with code 40001', () => {
    expect(isSerializationFailure(makeSerializationError())).toBe(true);
  });

  it('detects Drizzle-wrapped error via cause chain', () => {
    expect(isSerializationFailure(makeDrizzleWrappedError())).toBe(true);
  });

  it('detects error by message when code is missing', () => {
    const error = new Error(
      'could not serialize access due to concurrent update',
    );
    expect(isSerializationFailure(error)).toBe(true);
  });

  it('rejects unrelated errors', () => {
    expect(isSerializationFailure(new Error('connection refused'))).toBe(false);
  });

  it('rejects non-error values', () => {
    expect(isSerializationFailure(null)).toBe(false);
    expect(isSerializationFailure('40001')).toBe(false);
    expect(isSerializationFailure(undefined)).toBe(false);
  });
});
