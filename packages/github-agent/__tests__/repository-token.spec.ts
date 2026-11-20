import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import {
  getInstallationToken,
  getRepositoryInstallationToken,
} from '../src/token.js';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = keys.privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString();
const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
const opts = {
  appId: 'app',
  privateKeyPem,
  repository: 'owner/repository',
  permissions: { contents: 'read' as const, pull_requests: 'write' as const },
};
it('uses shared signed claims, custom API and repository/permission restriction without a disk cache', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-20T00:00:00Z'));
  const requests: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      requests.push({ url, init });
      return Promise.resolve(
        new Response(
          JSON.stringify(
            url.endsWith('/installation')
              ? { id: 7 }
              : {
                  token: 'restricted-token',
                  expires_at: new Date(Date.now() + 3600_000).toISOString(),
                },
          ),
        ),
      );
    }),
  );
  expect(
    (
      await getRepositoryInstallationToken({
        ...opts,
        apiUrl: 'https://github.enterprise/api/v3/',
      })
    ).token,
  ).toBe('restricted-token');
  expect(requests.map((r) => r.url)).toEqual([
    'https://github.enterprise/api/v3/repos/owner/repository/installation',
    'https://github.enterprise/api/v3/app/installations/7/access_tokens',
  ]);
  expect(JSON.parse(String(requests[1].init.body))).toEqual({
    repositories: ['repository'],
    permissions: opts.permissions,
  });
  for (const { init } of requests) {
    const jwt = new Headers(init.headers)
      .get('Authorization')!
      .slice('Bearer '.length);
    const [header, payload, signature] = jwt.split('.');
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(`${header}.${payload}`),
        keys.publicKey,
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({
      iss: 'app',
      iat: Date.now() / 1000 - 60,
      exp: Date.now() / 1000 + 600,
    });
  }
});
it.each([
  { token: '', expires_at: '2099-01-01' },
  { token: 'token', expires_at: 'invalid' },
  { token: 'token', expires_at: '2000-01-01' },
])('rejects malformed or expired token responses: %j', async (response) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(response)))),
  );
  await expect(
    getInstallationToken({
      appId: 'app',
      privateKeyPem,
      installationId: '7',
      cache: false,
    }),
  ).rejects.toThrow('invalid or expired');
});
it('never reuses an installation disk token for different repository or permission scope', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'github-scope-'));
  dirs.push(cacheDir);
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          token: `token-${fetchMock.mock.calls.length}`,
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        }),
      ),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  const base = {
    appId: 'app',
    privateKeyPem,
    installationId: '7',
    cacheDir,
    repositories: ['one'],
    permissions: { contents: 'read' as const },
  };
  await getInstallationToken(base);
  await getInstallationToken(base);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await getInstallationToken({ ...base, repositories: ['two'] });
  await getInstallationToken({ ...base, permissions: { contents: 'write' } });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
it('rejects failed repository lookup and invalid installation metadata', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{}', { status: 403 }))),
  );
  await expect(getRepositoryInstallationToken(opts)).rejects.toThrow('(403)');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{}'))),
  );
  await expect(getRepositoryInstallationToken(opts)).rejects.toThrow(
    'invalid installation',
  );
});
