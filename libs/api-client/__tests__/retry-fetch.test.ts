import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRateLimitFetch, createRetryFetch } from '../src/retry-fetch.js';

describe('createRetryFetch', () => {
  let mockFetch: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    mockFetch = vi.fn<typeof fetch>();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function flushRetryDelay(): Promise<void> {
    return vi.advanceTimersByTimeAsync(15_000);
  }

  it('returns immediately on 200 without retrying', async () => {
    const ok = new Response('ok', { status: 200 });
    mockFetch.mockResolvedValueOnce(ok);
    const retryFetch = createRetryFetch({ baseFetch: mockFetch });

    const res = await retryFetch('https://api.test/foo');

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 then succeeds', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('err', { status: 503 }))
      .mockResolvedValueOnce(new Response('err', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const retryFetch = createRetryFetch({
      baseFetch: mockFetch,
      maxRetries: 3,
    });

    const promise = retryFetch('https://api.test/foo');
    await flushRetryDelay();
    const res = await promise;

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('retries on network error then succeeds', async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const retryFetch = createRetryFetch({ baseFetch: mockFetch });

    const promise = retryFetch('https://api.test/foo');
    await flushRetryDelay();
    const res = await promise;

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('respects maxRetries and returns last response', async () => {
    mockFetch.mockResolvedValue(new Response('err', { status: 500 }));

    const retryFetch = createRetryFetch({
      baseFetch: mockFetch,
      maxRetries: 2,
    });

    const promise = retryFetch('https://api.test/foo');
    await flushRetryDelay();
    const res = await promise;

    expect(res.status).toBe(500);
    expect(mockFetch).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('does not retry non-idempotent POST by default', async () => {
    mockFetch.mockResolvedValueOnce(new Response('err', { status: 500 }));

    const retryFetch = createRetryFetch({ baseFetch: mockFetch });

    const res = await retryFetch('https://api.test/foo', {
      method: 'POST',
    });

    expect(res.status).toBe(500);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries POST on 429 (rate limited)', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const retryFetch = createRetryFetch({ baseFetch: mockFetch });

    const promise = retryFetch('https://api.test/foo', {
      method: 'POST',
    });
    await flushRetryDelay();
    const res = await promise;

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('honors Retry-After header (seconds)', async () => {
    const headers = new Headers({ 'Retry-After': '2' });
    mockFetch
      .mockResolvedValueOnce(new Response('retry', { status: 429, headers }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const delays: number[] = [];
    const retryFetch = createRetryFetch({
      baseFetch: mockFetch,
      onRetry: (_attempt, delay) => delays.push(delay),
    });

    const promise = retryFetch('https://api.test/foo');
    await flushRetryDelay();
    await promise;

    expect(delays[0]).toBe(2000);
  });

  it('does not retry 4xx errors (400, 401, 403, 404)', async () => {
    for (const status of [400, 401, 403, 404]) {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(new Response('err', { status }));
      const retryFetch = createRetryFetch({ baseFetch: mockFetch });

      const res = await retryFetch('https://api.test/foo');

      expect(res.status).toBe(status);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    }
  });

  it('throws after maxRetries on persistent network error', async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'));

    const retryFetch = createRetryFetch({
      baseFetch: mockFetch,
      maxRetries: 2,
    });

    const promise = retryFetch('https://api.test/foo');
    // Attach the rejection handler before flushing timers to avoid
    // an unhandled-rejection warning from the async retry loop.
    const assertion = expect(promise).rejects.toThrow('fetch failed');
    await flushRetryDelay();

    await assertion;
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('uses exponential backoff with increasing delays', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('err', { status: 503 }))
      .mockResolvedValueOnce(new Response('err', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const delays: number[] = [];
    const retryFetch = createRetryFetch({
      baseFetch: mockFetch,
      maxRetries: 3,
      baseDelay: 500,
      jitter: false,
      onRetry: (_attempt, delay) => delays.push(delay),
    });

    const promise = retryFetch('https://api.test/foo');
    await flushRetryDelay();
    await promise;

    // baseDelay * 2^attempt: 500*2^0=500, 500*2^1=1000
    expect(delays).toEqual([500, 1000]);
  });
});

describe('createRateLimitFetch (backward-compat alias)', () => {
  it('retries on 429 and returns a fetch function', async () => {
    const mockFetch = vi.fn<typeof fetch>();
    vi.useFakeTimers();

    mockFetch
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    // Patch globalThis.fetch so createRateLimitFetch picks it up
    const original = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const rateFetch = createRateLimitFetch({ maxRetries: 2 });
      const promise = rateFetch('https://api.test/foo', { method: 'POST' });
      await vi.advanceTimersByTimeAsync(35_000);
      const res = await promise;

      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = original;
      vi.useRealTimers();
    }
  });
});
