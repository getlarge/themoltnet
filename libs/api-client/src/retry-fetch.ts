import { setTimeout } from 'node:timers/promises';

export interface RateLimitRetryOptions {
  /** Max retries for 429. Default: 3 */
  maxRetries?: number;
  /** Base delay in ms when no Retry-After header. Default: 1000 */
  baseDelayMs?: number;
  /** Max backoff delay in ms. Default: 30000 */
  maxDelayMs?: number;
}

interface ResolvedOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULTS: ResolvedOptions = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
};

function resolveOptions(options?: RateLimitRetryOptions): ResolvedOptions {
  return { ...DEFAULTS, ...options };
}

function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const delay = baseMs * 2 ** attempt;
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
 * Create a fetch wrapper that retries on 429 (rate limited) responses.
 *
 * Respects the `Retry-After` header when present, otherwise falls back
 * to exponential backoff with jitter.
 *
 * Safe for all HTTP methods — a 429 means the request was not processed.
 */
export function createRateLimitFetch(
  options?: RateLimitRetryOptions,
): typeof fetch {
  const opts = resolveOptions(options);

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    let retries = 0;

    const doFetch = async (): Promise<Response> => {
      const response = await globalThis.fetch(input, init);

      if (response.status === 429 && retries < opts.maxRetries) {
        const delayMs =
          parseRetryAfter(response) ??
          backoffDelay(retries, opts.baseDelayMs, opts.maxDelayMs);
        retries++;
        await setTimeout(delayMs);
        return doFetch();
      }

      return response;
    };

    return doFetch();
  };
}
