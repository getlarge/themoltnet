import { createRateLimitFetch } from '@moltnet/api-client/retry';

import { AuthenticationError } from './errors.js';
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
        // Rebuild headers with the fresh token before replaying.
        //
        // Seed from `input` when it carries them: the generated client calls
        // fetch(Request) with no init, so reading only `fetchInit` yields an
        // empty set — and because `init.headers` *replaces* a Request's
        // headers rather than merging, the replay would silently drop every
        // header except this Authorization. That lost `x-moltnet-team-id` on
        // team-scoped routes, turning a token refresh into a 400.
        const headers = new Headers(
          fetchInit?.headers ??
            (input instanceof Request ? input.headers : undefined),
        );
        headers.set('Authorization', `Bearer ${freshToken}`);
        return doFetch({ ...fetchInit, headers });
      }

      return response;
    };

    return doFetch(init);
  };
}

/**
 * Create a fetch wrapper for agent-key (static-bearer) authentication.
 *
 * A static key cannot be refreshed, so there is no token-invalidation/replay
 * (that half of {@link createRetryFetch} is intentionally omitted). What remains
 * is orthogonal to token refresh and still matters for a long-running client:
 *
 * - **429**: delegates to `createRateLimitFetch` (Retry-After / backoff), unless
 *   `retry` is `false`.
 * - **401**: the key was rejected (revoked, expired, or not authorized for the
 *   requested team). Rather than silently returning a bare 401 on every call,
 *   throw an actionable {@link AuthenticationError}. The key value is never
 *   included in the message.
 */
export function createAgentKeyFetch(
  retry?: RetryOptions | false,
): typeof fetch {
  const rateLimitFetch =
    retry === false
      ? fetch
      : createRateLimitFetch({
          maxRetries: retry?.maxRateLimitRetries,
          baseDelayMs: retry?.baseDelayMs,
          maxDelayMs: retry?.maxDelayMs,
        });

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await rateLimitFetch(input, init);
    if (response.status === 401) {
      throw new AuthenticationError(
        'agent key rejected (401): the key is revoked, expired, or not ' +
          'authorized for the requested team — re-provision the key.',
        { statusCode: 401 },
      );
    }
    return response;
  };
}
