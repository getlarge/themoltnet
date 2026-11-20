import { generateKeyPairSync } from 'node:crypto';

import { afterEach, expect, it, vi } from 'vitest';

import { reviewGithubToken } from '../src/github-auth.js';

const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('uses the explicit token fallback and fails when neither credential form exists', async () => {
  expect(
    await reviewGithubToken('owner/repo', { GH_TOKEN: 'fallback' })(),
  ).toBe('fallback');
  await expect(
    Promise.resolve().then(() => reviewGithubToken('owner/repo', {})()),
  ).rejects.toThrow('GH_TOKEN');
});
it('retries after failed mint and refreshes at the exact renewal boundary', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-20T00:00:00Z'));
  let fail = true;
  const fetchMock = vi.fn((url: string) => {
    if (fail) {
      fail = false;
      return Promise.resolve(new Response('{}', { status: 500 }));
    }
    return Promise.resolve(
      new Response(
        JSON.stringify(
          url.endsWith('/installation')
            ? { id: 7 }
            : {
                token: 'token',
                expires_at: new Date(Date.now() + 3600_000).toISOString(),
              },
        ),
      ),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  const token = reviewGithubToken('owner/repo', {
    ADAPTIVE_GITHUB_APP_ID: 'app',
    MOLTNET_GITHUB_APP_PRIVATE_KEY: privateKey,
  });
  await expect(token()).rejects.toThrow('(500)');
  await Promise.all([token(), token()]);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  vi.advanceTimersByTime(55 * 60_000 - 1);
  await token();
  expect(fetchMock).toHaveBeenCalledTimes(3);
  vi.advanceTimersByTime(1);
  await token();
  expect(fetchMock).toHaveBeenCalledTimes(5);
});

it('uses read-only GitHub authority for report-only reviews', async () => {
  const requests: RequestInit[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      requests.push(init);
      return Promise.resolve(
        new Response(
          JSON.stringify(
            url.endsWith('/installation')
              ? { id: 7 }
              : {
                  token: 'token',
                  expires_at: new Date(Date.now() + 3600_000).toISOString(),
                },
          ),
        ),
      );
    }),
  );
  await reviewGithubToken(
    'owner/repo',
    {
      ADAPTIVE_GITHUB_APP_ID: 'app',
      MOLTNET_GITHUB_APP_PRIVATE_KEY: privateKey,
    },
    'report-only',
  )();
  expect(JSON.parse(String(requests[1].body))).toMatchObject({
    permissions: { contents: 'read', pull_requests: 'read' },
  });
});
