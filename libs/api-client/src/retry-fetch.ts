export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  retryStatuses?: number[];
  retryMethods?: string[];
  retryOnNetworkError?: boolean;
  /** Inject a custom fetch for testing. Defaults to globalThis.fetch. */
  baseFetch?: typeof fetch;
  /** Disable jitter for deterministic tests. Defaults to true. */
  jitter?: boolean;
  /** Called before each retry. Useful for logging or testing delay values. */
  onRetry?: (attempt: number, delay: number, reason: string) => void;
}

const DEFAULT_RETRY_STATUSES = [408, 429, 500, 502, 503, 504];
const DEFAULT_RETRY_METHODS = ['GET', 'HEAD', 'OPTIONS', 'PUT'];

export function createRetryFetch(options?: RetryOptions): typeof fetch {
  const {
    maxRetries = 3,
    baseDelay = 500,
    maxDelay = 10_000,
    retryStatuses = DEFAULT_RETRY_STATUSES,
    retryMethods = DEFAULT_RETRY_METHODS,
    retryOnNetworkError = true,
    baseFetch = globalThis.fetch,
    jitter = true,
    onRetry,
  } = options ?? {};

  const retryMethodSet = new Set(retryMethods.map((m) => m.toUpperCase()));

  return async function retryFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase();

    let lastError: unknown;
    let lastResponse: Response | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await baseFetch(
          input instanceof Request ? input.clone() : input,
          init,
        );

        // 429 retries all methods (request never executed)
        const isRateLimited = response.status === 429;
        const shouldRetryStatus =
          retryStatuses.includes(response.status) &&
          (isRateLimited || retryMethodSet.has(method));

        if (!shouldRetryStatus || attempt === maxRetries) {
          return response;
        }

        lastResponse = response;
        const delay = computeDelay(
          attempt,
          baseDelay,
          maxDelay,
          jitter,
          response,
        );
        onRetry?.(attempt, delay, `status ${response.status}`);
        await sleep(delay);
      } catch (err) {
        lastError = err;
        if (
          !retryOnNetworkError ||
          !retryMethodSet.has(method) ||
          attempt === maxRetries
        ) {
          throw err;
        }
        const delay = computeDelay(attempt, baseDelay, maxDelay, jitter);
        onRetry?.(attempt, delay, 'network error');
        await sleep(delay);
      }
    }

    // Should not reach here, but satisfy TypeScript
    if (lastResponse) return lastResponse;
    throw lastError;
  };
}

function computeDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  jitter: boolean,
  response?: Response,
): number {
  // Honor Retry-After header
  const retryAfter = response?.headers.get('Retry-After');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds)) {
      return Math.min(seconds * 1000, maxDelay);
    }
    // HTTP-date format
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) {
      return Math.min(Math.max(date - Date.now(), 0), maxDelay);
    }
  }

  const exponential = baseDelay * 2 ** attempt;
  const jitterMs = jitter ? Math.random() * baseDelay : 0;
  return Math.min(exponential + jitterMs, maxDelay);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ── Backward-compatible alias for SDK ──────────────────────────
// The SDK's retry.ts imports createRateLimitFetch from
// '@moltnet/api-client/retry'. This alias preserves that contract
// while using the more capable createRetryFetch under the hood.

export interface RateLimitRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export function createRateLimitFetch(
  options?: RateLimitRetryOptions,
): typeof fetch {
  return createRetryFetch({
    maxRetries: options?.maxRetries ?? 3,
    baseDelay: options?.baseDelayMs ?? 1_000,
    maxDelay: options?.maxDelayMs ?? 30_000,
    retryStatuses: [429],
    retryMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
    retryOnNetworkError: false,
  });
}
