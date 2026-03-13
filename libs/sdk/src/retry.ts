import { createRateLimitFetch } from '@moltnet/api-client/retry';

import type { TokenManager } from './token.js';

export type { RateLimitRetryOptions } from '@moltnet/api-client/retry';

export interface RetryOptions {
  /** Max retries for 401 (token refresh + replay). Default: 1 */
  maxAuthRetries?: number;
  /** Max retries for 429 (rate limit). Default: 3 */
  maxRateLimitRetries?: number;
  /** Base delay in ms for 429 backoff when no Retry-After header. Default: 1000 */
  baseDelayMs?: number;
  /** Max backoff delay in ms. Default: 30000 */
  maxDelayMs?: number;
}

const AUTH_RETRY_DEFAULT = 1;

/**
 * Create a fetch wrapper that retries on 401 and 429.
 *
 * - **401**: Invalidates the cached token, re-authenticates, replays once.
 * - **429**: Delegates to `createRateLimitFetch` from `@moltnet/api-client/retry`.
 *
 * 5xx and network errors are not retried — non-idempotent methods (POST, PATCH)
 * could cause duplicate side effects.
 */
export function createRetryFetch(
  tokenManager: TokenManager,
  options?: RetryOptions,
): typeof fetch {
  const maxAuthRetries = options?.maxAuthRetries ?? AUTH_RETRY_DEFAULT;

  const rateLimitFetch = createRateLimitFetch({
    maxRetries: options?.maxRateLimitRetries,
    baseDelayMs: options?.baseDelayMs,
    maxDelayMs: options?.maxDelayMs,
  });

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    let authRetries = 0;

    const doFetch = async (fetchInit?: RequestInit): Promise<Response> => {
      const response = await rateLimitFetch(input, fetchInit);

      if (response.status === 401 && authRetries < maxAuthRetries) {
        authRetries++;
        tokenManager.invalidate();
        const freshToken = await tokenManager.authenticate();
        // Rebuild headers with the fresh token before replaying
        const headers = new Headers(fetchInit?.headers);
        headers.set('Authorization', `Bearer ${freshToken}`);
        return doFetch({ ...fetchInit, headers });
      }

      return response;
    };

    return doFetch(init);
  };
}
