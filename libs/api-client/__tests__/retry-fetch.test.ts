import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRateLimitFetch } from '../src/retry-fetch.js';

vi.mock('node:timers/promises', () => ({
  setTimeout: vi.fn().mockResolvedValue(undefined),
}));

const mockFetch = vi.fn<typeof globalThis.fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('createRateLimitFetch', () => {
  it('should pass through successful responses', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const retryFetch = createRateLimitFetch();
    const response = await retryFetch('https://api.test/resource');

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('should not retry on non-429 errors', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(500, { error: 'fail' }));

    const retryFetch = createRateLimitFetch();
    const response = await retryFetch('https://api.test/resource');

    expect(response.status).toBe(500);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('should not retry on network errors', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    const retryFetch = createRateLimitFetch();

    await expect(retryFetch('https://api.test/resource')).rejects.toThrow(
      'fetch failed',
    );
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('should retry on 429 with Retry-After header (seconds)', async () => {
    const { setTimeout: mockSetTimeout } = await import('node:timers/promises');

    mockFetch
      .mockResolvedValueOnce(
        jsonResponse(429, { error: 'rate limited' }, { 'Retry-After': '2' }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const retryFetch = createRateLimitFetch();
    const response = await retryFetch('https://api.test/resource');

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockSetTimeout).toHaveBeenCalledWith(2000);
  });

  it('should fall back to exponential backoff without Retry-After', async () => {
    const { setTimeout: mockSetTimeout } = await import('node:timers/promises');

    mockFetch
      .mockResolvedValueOnce(jsonResponse(429, { error: 'rate limited' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const retryFetch = createRateLimitFetch({
      baseDelayMs: 100,
      maxDelayMs: 5000,
    });
    const response = await retryFetch('https://api.test/resource');

    expect(response.status).toBe(200);
    expect(mockSetTimeout).toHaveBeenCalledOnce();
    const delayArg = vi.mocked(mockSetTimeout).mock.calls[0]![0] as number;
    // attempt 0 with base 100: 100ms ± 25% jitter → 75..125
    expect(delayArg).toBeGreaterThanOrEqual(75);
    expect(delayArg).toBeLessThanOrEqual(125);
  });

  it('should retry multiple 429s up to maxRetries', async () => {
    const { setTimeout: mockSetTimeout } = await import('node:timers/promises');

    mockFetch
      .mockResolvedValueOnce(
        jsonResponse(429, { error: 'limited' }, { 'Retry-After': '1' }),
      )
      .mockResolvedValueOnce(
        jsonResponse(429, { error: 'limited' }, { 'Retry-After': '1' }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const retryFetch = createRateLimitFetch({ maxRetries: 3 });
    const response = await retryFetch('https://api.test/resource');

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockSetTimeout).toHaveBeenCalledTimes(2);
  });

  it('should stop after maxRetries', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse(429, { error: 'limited' }, { 'Retry-After': '1' }),
      )
      .mockResolvedValueOnce(
        jsonResponse(429, { error: 'limited' }, { 'Retry-After': '1' }),
      );

    const retryFetch = createRateLimitFetch({ maxRetries: 1 });
    const response = await retryFetch('https://api.test/resource');

    expect(response.status).toBe(429);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should retry 429 for POST requests', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse(429, { error: 'limited' }, { 'Retry-After': '1' }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const retryFetch = createRateLimitFetch();
    const response = await retryFetch('https://api.test/resource', {
      method: 'POST',
      body: JSON.stringify({ data: 'test' }),
    });

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should cap backoff delay at maxDelayMs', async () => {
    const { setTimeout: mockSetTimeout } = await import('node:timers/promises');

    mockFetch
      .mockResolvedValueOnce(jsonResponse(429, { error: 'limited' }))
      .mockResolvedValueOnce(jsonResponse(429, { error: 'limited' }))
      .mockResolvedValueOnce(jsonResponse(429, { error: 'limited' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const retryFetch = createRateLimitFetch({
      maxRetries: 5,
      baseDelayMs: 5000,
      maxDelayMs: 8000,
    });
    await retryFetch('https://api.test/resource');

    // All delays should be capped at maxDelayMs
    for (const call of vi.mocked(mockSetTimeout).mock.calls) {
      expect(call[0] as number).toBeLessThanOrEqual(8000);
    }
  });
});
