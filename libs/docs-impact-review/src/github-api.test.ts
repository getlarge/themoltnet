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

describe('GitHubApi', () => {
  it('retries rate limits and server errors, honoring retry-after', async () => {
    // Arrange
    const waits: number[] = [];
    const { urls, fetchImpl } = sequence([
      { status: 429, headers: { 'retry-after': '2' } },
      { status: 502 },
      { status: 200, body: { ok: true } },
    ]);
    const api = new GitHubApi({
      token: 't',
      fetchImpl,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });

    // Act
    const result = await api.request<{ ok: boolean }>('/repos/o/r');

    // Assert
    expect(result).toEqual({ ok: true });
    expect(urls).toHaveLength(3);
    expect(waits).toEqual([2_000, 2_000]);
  });

  it('gives up after the last attempt with the GitHub message', async () => {
    // Arrange
    const { fetchImpl } = sequence([
      { status: 503 },
      { status: 503 },
      { status: 503, body: { message: 'Service unavailable' } },
    ]);
    const api = new GitHubApi({
      token: 't',
      fetchImpl,
      sleep: () => Promise.resolve(),
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
