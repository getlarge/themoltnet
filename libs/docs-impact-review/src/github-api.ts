import { createRetryFetch, type RetryOptions } from '@moltnet/api-client/retry';

/** A GitHub API response that failed; `status` is the HTTP status. */
export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

export interface GitHubApiOptions {
  token: string;
  /** `GITHUB_API_URL` on GitHub Enterprise Server; api.github.com otherwise. */
  apiUrl?: string;
  fetchImpl?: typeof fetch;
  /** Backoff tuning; tests shorten the delays. */
  retry?: Pick<
    RetryOptions,
    'maxRetries' | 'baseDelay' | 'maxDelay' | 'jitter'
  >;
  /** Budget for one request, retries included. */
  timeoutMs?: number;
  /** Where retries are reported; stderr by default. */
  log?: (message: string) => void;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * GitHub reports secondary rate limits as 403 with `retry-after`, and an
 * exhausted primary limit as 403 with `x-ratelimit-remaining: 0`. Either way
 * the request was not executed, so it is retried like a 429, whatever the
 * method.
 */
function rateLimitsAs429(baseFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (
      response.status === 403 &&
      (response.headers.has('retry-after') ||
        response.headers.get('x-ratelimit-remaining') === '0')
    ) {
      return new Response(response.body, {
        status: 429,
        statusText: 'rate limited (403)',
        headers: response.headers,
      });
    }
    return response;
  };
}

/**
 * Minimal GitHub REST client for the review's own calls: headers,
 * pagination, and errors that carry GitHub's message. Retries come from
 * `createRetryFetch`: rate limits for every method (the request was never
 * executed), server errors and network failures only for idempotent methods,
 * so a comment is never posted twice.
 */
export class GitHubApi {
  private readonly apiUrl: string;
  private readonly baseFetch: typeof fetch;
  private readonly log: (message: string) => void;

  constructor(private readonly options: GitHubApiOptions) {
    let apiUrl = options.apiUrl || 'https://api.github.com';
    while (apiUrl.endsWith('/')) apiUrl = apiUrl.slice(0, -1);
    this.apiUrl = apiUrl;
    this.baseFetch = rateLimitsAs429(options.fetchImpl ?? fetch);
    this.log =
      options.log ?? ((message) => process.stderr.write(`${message}\n`));
  }

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const method = (init?.method ?? 'GET').toUpperCase();
    const retryFetch = createRetryFetch({
      baseDelay: 1_000,
      maxDelay: 30_000,
      ...this.options.retry,
      baseFetch: this.baseFetch,
      onRetry: (attempt, delay, reason) =>
        this.log(
          `GitHub API ${method} ${path}: ${reason}, retry ${attempt + 1} in ${Math.round(delay)} ms`,
        ),
    });
    const response = await retryFetch(`${this.apiUrl}${path}`, {
      ...init,
      method,
      signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.options.token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
        ...init?.headers,
      },
    });
    if (response.ok) return (await response.json()) as T;
    const detail = await response
      .json()
      .then((body: { message?: unknown }) =>
        typeof body.message === 'string' ? `: ${body.message}` : '',
      )
      .catch(() => '');
    throw new GitHubApiError(
      `GitHub API ${method} ${path} failed with ${response.status}${detail}`,
      response.status,
    );
  }

  /** Follows `per_page=100` pages until a short page. */
  async paginate<T>(path: string): Promise<T[]> {
    const separator = path.includes('?') ? '&' : '?';
    const items: T[] = [];
    for (let page = 1; ; page += 1) {
      const batch = await this.request<T[]>(
        `${path}${separator}per_page=100&page=${page}`,
      );
      items.push(...batch);
      if (batch.length < 100) return items;
    }
  }
}
