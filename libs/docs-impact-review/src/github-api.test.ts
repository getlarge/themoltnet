import { describe, expect, it } from 'vitest';

import { GitHubApi, GitHubApiError } from './github-api.js';

function sequence(
  responses: Array<{
    status: number;
    body?: unknown;
    headers?: Record<string, string>;
  }>,
) {
  const urls: string[] = [];
  const fetchImpl = ((url: string) => {
    urls.push(url);
    const next = responses.shift() ?? { status: 500 };
    return Promise.resolve(
      new Response(JSON.stringify(next.body ?? {}), {
        status: next.status,
        headers: next.headers,
      }),
    );
  }) as typeof fetch;
  return { urls, fetchImpl };
}

const FAST = { baseDelay: 1, jitter: false };

describe('GitHubApi', () => {
  it('retries rate limits and server errors on reads, logging each retry', async () => {
    // Arrange
    const logs: string[] = [];
    const { urls, fetchImpl } = sequence([
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 502 },
      { status: 200, body: { ok: true } },
    ]);
    const api = new GitHubApi({
      token: 't',
      fetchImpl,
      retry: FAST,
      log: (message) => logs.push(message),
    });

    // Act
    const result = await api.request<{ ok: boolean }>('/repos/o/r');

    // Assert
    expect(result).toEqual({ ok: true });
    expect(urls).toHaveLength(3);
    expect(logs).toEqual([
      expect.stringContaining('GET /repos/o/r: status 429, retry 1'),
      expect.stringContaining('GET /repos/o/r: status 502, retry 2'),
    ]);
  });

  it('never retries a write on a server error, which may have applied it', async () => {
    // Arrange
    const { urls, fetchImpl } = sequence([
      { status: 502 },
      { status: 201, body: {} },
    ]);
    const api = new GitHubApi({
      token: 't',
      fetchImpl,
      retry: FAST,
      log: () => {},
    });

    // Act / Assert
    await expect(
      api.request('/repos/o/r/issues/1/comments', {
        method: 'POST',
        body: '{}',
      }),
    ).rejects.toThrow(
      'GitHub API POST /repos/o/r/issues/1/comments failed with 502',
    );
    expect(urls).toHaveLength(1);
  });

  it.each([
    ['a secondary rate limit', { 'retry-after': '0' }],
    ['an exhausted primary rate limit', { 'x-ratelimit-remaining': '0' }],
  ])('retries a write refused by %s', async (_label, headers) => {
    // Arrange
    const { urls, fetchImpl } = sequence([
      { status: 403, headers },
      { status: 201, body: { id: 1 } },
    ]);
    const api = new GitHubApi({
      token: 't',
      fetchImpl,
      retry: FAST,
      log: () => {},
    });

    // Act
    const result = await api.request('/repos/o/r/issues/1/comments', {
      method: 'POST',
      body: '{}',
    });

    // Assert
    expect(result).toEqual({ id: 1 });
    expect(urls).toHaveLength(2);
  });

  it('fails at once on a rate limit longer than the run waits', async () => {
    // Arrange
    const { urls, fetchImpl } = sequence([
      { status: 403, headers: { 'retry-after': '3600' } },
      { status: 200, body: {} },
    ]);
    const api = new GitHubApi({
      token: 't',
      fetchImpl,
      retry: FAST,
      log: () => {},
    });

    // Act / Assert
    await expect(api.request('/repos/o/r')).rejects.toMatchObject({
      message:
        'GitHub API GET /repos/o/r is rate limited for 3600 s, longer than this run waits',
      status: 429,
    });
    expect(urls).toHaveLength(1);
  });

  it('waits for a primary rate limit reset within the budget', async () => {
    // Arrange
    const now = 1_000_000;
    const { urls, fetchImpl } = sequence([
      {
        status: 403,
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(now / 1_000),
        },
      },
      { status: 200, body: { ok: true } },
    ]);
    const api = new GitHubApi({
      token: 't',
      fetchImpl,
      retry: FAST,
      log: () => {},
      now: () => now,
    });

    // Act
    const result = await api.request('/repos/o/r');

    // Assert
    expect(result).toEqual({ ok: true });
    expect(urls).toHaveLength(2);
  });

  it('retries an idempotent edit on a server error', async () => {
    // Arrange
    const { urls, fetchImpl } = sequence([
      { status: 502 },
      { status: 200, body: { id: 5 } },
    ]);
    const api = new GitHubApi({
      token: 't',
      fetchImpl,
      retry: FAST,
      log: () => {},
    });

    // Act
    const result = await api.request('/repos/o/r/issues/comments/5', {
      method: 'PATCH',
      body: '{}',
    });

    // Assert
    expect(result).toEqual({ id: 5 });
    expect(urls).toHaveLength(2);
  });

  it('gives up after the last attempt with the GitHub message', async () => {
    // Arrange
    const { fetchImpl } = sequence([
      { status: 503 },
      { status: 503 },
      { status: 503 },
      { status: 503, body: { message: 'Service unavailable' } },
    ]);
    const api = new GitHubApi({
      token: 't',
      fetchImpl,
      retry: FAST,
      log: () => {},
    });

    // Act / Assert
    await expect(api.request('/repos/o/r')).rejects.toThrow(
      'GitHub API GET /repos/o/r failed with 503: Service unavailable',
    );
  });

  it('does not retry client errors', async () => {
    // Arrange
    const { urls, fetchImpl } = sequence([{ status: 404, body: {} }]);
    const api = new GitHubApi({ token: 't', fetchImpl });

    // Act / Assert
    await expect(api.request('/repos/o/r')).rejects.toBeInstanceOf(
      GitHubApiError,
    );
    expect(urls).toHaveLength(1);
  });

  it('uses the configured API URL, as on GitHub Enterprise Server', async () => {
    // Arrange
    const { urls, fetchImpl } = sequence([{ status: 200, body: {} }]);
    const api = new GitHubApi({
      token: 't',
      apiUrl: 'https://ghe.example.com/api/v3/',
      fetchImpl,
    });

    // Act
    await api.request('/repos/o/r');

    // Assert
    expect(urls).toEqual(['https://ghe.example.com/api/v3/repos/o/r']);
  });

  it('follows pages until a short page', async () => {
    // Arrange
    const full = Array.from({ length: 100 }, (_, index) => ({ index }));
    const { urls, fetchImpl } = sequence([
      { status: 200, body: full },
      { status: 200, body: [{ index: 100 }] },
    ]);
    const api = new GitHubApi({ token: 't', fetchImpl });

    // Act
    const items = await api.paginate('/repos/o/r/pulls/7/files');

    // Assert
    expect(items).toHaveLength(101);
    expect(urls[1]).toContain('/repos/o/r/pulls/7/files?per_page=100&page=2');
  });
});
