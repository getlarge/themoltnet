import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';

import { afterEach, expect, it, vi } from 'vitest';

import { reviewGithubToken } from '../src/github-auth.js';

const { privateKey: rsaKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const privateKey = rsaKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const pkcs1PrivateKey = rsaKey
  .export({ type: 'pkcs1', format: 'pem' })
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
it.each([
  ['raw PKCS#8 PEM', privateKey],
  ['raw PKCS#1 PEM', pkcs1PrivateKey],
  ['escaped PKCS#1 newlines', pkcs1PrivateKey.replace(/\n/g, '\\n')],
  ['escaped newlines', privateKey.replace(/\n/g, '\\n')],
])(
  'signs repository-token requests with %s from the environment',
  async (_label, pem) => {
    const jwtSignatures: boolean[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        const authorization = new Headers(init.headers).get('authorization');
        const jwt = authorization?.replace(/^Bearer /i, '') ?? '';
        const [header, payload, signature] = jwt.split('.');
        jwtSignatures.push(
          verify(
            'RSA-SHA256',
            Buffer.from(`${header}.${payload}`),
            createPublicKey(privateKey),
            Buffer.from(signature, 'base64url'),
          ),
        );
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
    await expect(
      reviewGithubToken('owner/repo', {
        ADAPTIVE_GITHUB_APP_ID: 'app',
        MOLTNET_GITHUB_APP_PRIVATE_KEY: pem,
      })(),
    ).resolves.toBe('token');
    expect(jwtSignatures).toEqual([true, true]);
  },
);

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
