import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRetryFetch } from '../src/retry.js';
import { TokenManager } from '../src/token.js';

const mockFetch = vi.fn<typeof globalThis.fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function flushRetryDelay(): Promise<void> {
  return vi.advanceTimersByTimeAsync(35_000);
}

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

function tokenResponse(token: string) {
  return new Response(
    JSON.stringify({
      access_token: token,
      token_type: 'bearer',
      expires_in: 3600,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function createTokenManager() {
  return new TokenManager({
    clientId: 'test-client',
    clientSecret: 'test-secret',
    apiUrl: 'https://api.test',
  });
}

describe('createRetryFetch', () => {
  describe('401 retry', () => {
    it('should invalidate token, re-authenticate, and replay on 401', async () => {
      // First call: token fetch (for TokenManager.authenticate triggered by retry)
      // The retryFetch wraps globalThis.fetch, so the sequence is:
      // 1. retryFetch calls globalThis.fetch → 401
      // 2. retryFetch calls tokenManager.invalidate + authenticate
      //    → authenticate calls globalThis.fetch for token endpoint
      // 3. retryFetch retries → calls globalThis.fetch → 200
      mockFetch
        .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }))
        .mockResolvedValueOnce(tokenResponse('fresh-token'))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      const tm = createTokenManager();
      const retryFetch = createRetryFetch(tm, { maxAuthRetries: 1 });

      const response = await retryFetch('https://api.test/resource');

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should not retry 401 more than maxAuthRetries times', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }))
        .mockResolvedValueOnce(tokenResponse('fresh-token'))
        .mockResolvedValueOnce(
          jsonResponse(401, { error: 'still unauthorized' }),
        );

      const tm = createTokenManager();
      const retryFetch = createRetryFetch(tm, { maxAuthRetries: 1 });

      const response = await retryFetch('https://api.test/resource');

      expect(response.status).toBe(401);
      // 1st attempt (401) + token fetch + 2nd attempt (401 again, no more retries)
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should call tokenManager.invalidate before re-authenticating', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }))
        .mockResolvedValueOnce(tokenResponse('fresh-token'))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      const tm = createTokenManager();
      const invalidateSpy = vi.spyOn(tm, 'invalidate');
      const authenticateSpy = vi.spyOn(tm, 'authenticate');
      const retryFetch = createRetryFetch(tm, { maxAuthRetries: 1 });

      await retryFetch('https://api.test/resource');

      expect(invalidateSpy).toHaveBeenCalledOnce();
      expect(authenticateSpy).toHaveBeenCalledOnce();

      // invalidate must be called before authenticate
      const invalidateOrder = invalidateSpy.mock.invocationCallOrder[0]!;
      const authenticateOrder = authenticateSpy.mock.invocationCallOrder[0]!;
      expect(invalidateOrder).toBeLessThan(authenticateOrder);
    });

    it('should not retry 401 when maxAuthRetries is 0', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(401, { error: 'unauthorized' }),
      );

      const tm = createTokenManager();
      const retryFetch = createRetryFetch(tm, { maxAuthRetries: 0 });

      const response = await retryFetch('https://api.test/resource');

      expect(response.status).toBe(401);
      expect(mockFetch).toHaveBeenCalledOnce();
    });
  });

  describe('429 retry', () => {
    it('should retry on 429 with Retry-After header', async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse(429, { error: 'rate limited' }, { 'Retry-After': '2' }),
        )
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      const tm = createTokenManager();
      const retryFetch = createRetryFetch(tm, { maxRateLimitRetries: 3 });

      const promise = retryFetch('https://api.test/resource');
      await flushRetryDelay();
      const response = await promise;

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should fall back to exponential backoff when no Retry-After header', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(429, { error: 'rate limited' }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      const tm = createTokenManager();
      const retryFetch = createRetryFetch(tm, {
        maxRateLimitRetries: 3,
        baseDelayMs: 100,
        maxDelayMs: 5000,
      });

      const promise = retryFetch('https://api.test/resource');
      await flushRetryDelay();
      const response = await promise;

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry multiple 429s up to maxRateLimitRetries', async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse(429, { error: 'rate limited' }, { 'Retry-After': '1' }),
        )
        .mockResolvedValueOnce(
          jsonResponse(429, { error: 'rate limited' }, { 'Retry-After': '1' }),
        )
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      const tm = createTokenManager();
      const retryFetch = createRetryFetch(tm, { maxRateLimitRetries: 3 });

      const promise = retryFetch('https://api.test/resource');
      await flushRetryDelay();
      const response = await promise;

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should stop retrying after maxRateLimitRetries', async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse(429, { error: 'rate limited' }, { 'Retry-After': '1' }),
        )
        .mockResolvedValueOnce(
          jsonResponse(429, { error: 'rate limited' }, { 'Retry-After': '1' }),
        )
        .mockResolvedValueOnce(
          jsonResponse(429, { error: 'still limited' }, { 'Retry-After': '1' }),
        );

      const tm = createTokenManager();
      const retryFetch = createRetryFetch(tm, { maxRateLimitRetries: 2 });

      const promise = retryFetch('https://api.test/resource');
      await flushRetryDelay();
      const response = await promise;

      expect(response.status).toBe(429);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('no retry scenarios', () => {
    it('should not retry on 5xx', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(500, { error: 'server error' }),
      );

      const tm = createTokenManager();
      const retryFetch = createRetryFetch(tm);

      const response = await retryFetch('https://api.test/resource');

      expect(response.status).toBe(500);
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('should not retry on network errors', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      const tm = createTokenManager();
      const retryFetch = createRetryFetch(tm);

      await expect(retryFetch('https://api.test/resource')).rejects.toThrow(
        'fetch failed',
      );
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('should pass through successful responses untouched', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, { data: 'hello' }));

      const tm = createTokenManager();
      const retryFetch = createRetryFetch(tm);

      const response = await retryFetch('https://api.test/resource');

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ data: 'hello' });
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('should not retry on 4xx other than 401/429', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(403, { error: 'forbidden' }),
      );

      const tm = createTokenManager();
      const retryFetch = createRetryFetch(tm);

      const response = await retryFetch('https://api.test/resource');

      expect(response.status).toBe(403);
      expect(mockFetch).toHaveBeenCalledOnce();
    });
  });

  describe('combined 401 + 429', () => {
    it('should handle 401 then 429 in sequence', async () => {
      mockFetch
        // 1st attempt → 401
        .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }))
        // token re-fetch
        .mockResolvedValueOnce(tokenResponse('fresh-token'))
        // 2nd attempt → 429
        .mockResolvedValueOnce(
          jsonResponse(429, { error: 'rate limited' }, { 'Retry-After': '1' }),
        )
        // 3rd attempt → 200
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      const tm = createTokenManager();
      const retryFetch = createRetryFetch(tm, {
        maxAuthRetries: 1,
        maxRateLimitRetries: 3,
      });

      const promise = retryFetch('https://api.test/resource');
      await flushRetryDelay();
      const response = await promise;

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('401 header refresh', () => {
    it('should update Authorization header with fresh token on replay', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }))
        .mockResolvedValueOnce(tokenResponse('fresh-token'))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      const tm = createTokenManager();
      const retryFetch = createRetryFetch(tm, { maxAuthRetries: 1 });

      await retryFetch('https://api.test/resource', {
        headers: { Authorization: 'Bearer stale-token' },
      });

      // The replayed request (3rd fetch call) should have the fresh token
      const replayCall = mockFetch.mock.calls[2]!;
      const replayHeaders = new Headers(replayCall[1]?.headers as HeadersInit);
      expect(replayHeaders.get('Authorization')).toBe('Bearer fresh-token');
    });

    it('should add Authorization header on replay even if original had none', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }))
        .mockResolvedValueOnce(tokenResponse('fresh-token'))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      const tm = createTokenManager();
      const retryFetch = createRetryFetch(tm, { maxAuthRetries: 1 });

      await retryFetch('https://api.test/resource');

      const replayCall = mockFetch.mock.calls[2]!;
      const replayHeaders = new Headers(replayCall[1]?.headers as HeadersInit);
      expect(replayHeaders.get('Authorization')).toBe('Bearer fresh-token');
    });
  });

  describe('default options', () => {
    it('should use defaults when no options provided', async () => {
      // 401 → re-auth → 200 (default maxAuthRetries is 1)
      mockFetch
        .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }))
        .mockResolvedValueOnce(tokenResponse('fresh-token'))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      const tm = createTokenManager();
      const retryFetch = createRetryFetch(tm);

      const response = await retryFetch('https://api.test/resource');
      expect(response.status).toBe(200);
    });
  });
});
