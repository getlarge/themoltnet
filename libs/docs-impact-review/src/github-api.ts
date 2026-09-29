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
  /** Attempts per request, including the first. */
  attempts?: number;
  /** Test seam; defaults to a real delay. */
  sleep?: (ms: number) => Promise<void>;
}

/** Responses worth retrying: rate limits and transient server errors. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_WAIT_MS = 30_000;

function waitFor(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1_000, MAX_WAIT_MS);
  }
  return Math.min(1_000 * 2 ** attempt, MAX_WAIT_MS);
}

/**
 * Minimal GitHub REST client for the review's own calls. A transient failure
 * at publish time would otherwise throw away minutes of review work, so
 * rate limits and 5xx responses are retried with bounded backoff that honors
 * `retry-after`.
 */
export class GitHubApi {
  private readonly apiUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly attempts: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: GitHubApiOptions) {
    this.apiUrl = (options.apiUrl || 'https://api.github.com').replace(
      /\/+$/,
      '',
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.attempts = options.attempts ?? 3;
    this.sleep =
      options.sleep ??
      ((ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms);
        }));
  }

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const method = init?.method ?? 'GET';
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetchImpl(`${this.apiUrl}${path}`, {
        ...init,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${this.options.token}`,
          'content-type': 'application/json',
          'x-github-api-version': '2022-11-28',
          ...init?.headers,
        },
      });
      if (response.ok) return (await response.json()) as T;
      if (RETRYABLE.has(response.status) && attempt + 1 < this.attempts) {
        await this.sleep(waitFor(response, attempt));
        continue;
      }
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
