import { setTimeout } from 'node:timers/promises';

import type { TokenManager } from './token.js';

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

interface ResolvedRetryOptions {
  maxAuthRetries: number;
  maxRateLimitRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULTS: ResolvedRetryOptions = {
  maxAuthRetries: 1,
  maxRateLimitRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
};

function resolveOptions(options?: RetryOptions): ResolvedRetryOptions {
  return { ...DEFAULTS, ...options };
}

function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const delay = baseMs * 2 ** attempt;
  // Jitter: ±25%
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.min(delay + jitter, maxMs);
}

function parseRetryAfter(response: Response): number | null {
  const header = response.headers.get('Retry-After');
  if (!header) return null;

  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds * 1000;

  // RFC 7231: HTTP-date format
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());

  return null;
}

/**
 * Create a fetch wrapper that retries on 401 and 429.
 *
 * - **401**: Invalidates the cached token, re-authenticates, replays once.
 * - **429**: Respects `Retry-After` header, falls back to exponential backoff.
 *
 * 5xx and network errors are not retried — non-idempotent methods (POST, PATCH)
 * could cause duplicate side effects.
 */
export function createRetryFetch(
  tokenManager: TokenManager,
  options?: RetryOptions,
): typeof fetch {
  const opts = resolveOptions(options);

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    let authRetries = 0;
    let rateLimitRetries = 0;

    const doFetch = async (): Promise<Response> => {
      const response = await globalThis.fetch(input, init);

      if (response.status === 401 && authRetries < opts.maxAuthRetries) {
        authRetries++;
        tokenManager.invalidate();
        await tokenManager.authenticate();
        return doFetch();
      }

      if (
        response.status === 429 &&
        rateLimitRetries < opts.maxRateLimitRetries
      ) {
        const delayMs =
          parseRetryAfter(response) ??
          backoffDelay(rateLimitRetries, opts.baseDelayMs, opts.maxDelayMs);
        rateLimitRetries++;
        await setTimeout(delayMs);
        return doFetch();
      }

      return response;
    };

    return doFetch();
  };
}
