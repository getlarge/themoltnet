import { afterEach, describe, expect, it, vi } from 'vitest';

import { FetchGithubClient } from './github-fetch.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('FetchGithubClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fetches GitHub issues with the provided token', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          number: 1213,
          title: 'title',
          body: 'body',
          labels: [{ name: 'moltnet:plan-approved' }],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new FetchGithubClient({
      token: 'ghs_static',
      retryDelayMs: 0,
    });

    const issue = await client.getIssue('getlarge/themoltnet', 1213);

    expect(issue.labels).toEqual(['moltnet:plan-approved']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://api.github.com/repos/getlarge/themoltnet/issues/1213',
    );
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer ghs_static',
    );
  });

  it('retries transient network failures', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('socket closed'))
      .mockResolvedValueOnce(jsonResponse({ id: 1, body: 'comment' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new FetchGithubClient({
      token: 'ghs_static',
      retryDelayMs: 0,
    });

    await expect(
      client.updateIssueComment('getlarge/themoltnet', 1, 'comment'),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes MoltNet GitHub token once on 401', async () => {
    const tokenProvider = vi
      .fn<
        NonNullable<
          ConstructorParameters<typeof FetchGithubClient>[0]['tokenProvider']
        >
      >()
      .mockResolvedValueOnce('ghs_stale')
      .mockResolvedValueOnce('ghs_fresh');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('bad credentials', { status: 401 }))
      .mockResolvedValueOnce(
        jsonResponse({
          number: 1213,
          title: 'title',
          body: null,
          labels: [],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new FetchGithubClient({ tokenProvider, retryDelayMs: 0 });

    await expect(client.getIssue('getlarge/themoltnet', 1213)).resolves.toEqual(
      {
        number: 1213,
        title: 'title',
        body: '',
        labels: [],
      },
    );
    expect(tokenProvider).toHaveBeenNthCalledWith(1, {
      forceRefresh: false,
    });
    expect(tokenProvider).toHaveBeenNthCalledWith(2, {
      forceRefresh: true,
    });
    const [, refreshedInit] = fetchMock.mock.calls[1];
    expect(
      (refreshedInit?.headers as Record<string, string>).Authorization,
    ).toBe('Bearer ghs_fresh');
  });

  it('does not retry permission failures', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('forbidden', { status: 403 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new FetchGithubClient({
      token: 'ghs_static',
      retryDelayMs: 0,
    });

    await expect(
      client.addIssueLabel('getlarge/themoltnet', 42, 'moltnet:ready'),
    ).rejects.toThrow('GitHub API error (403)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
