import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { findInstallationForOwner } from '../src/token.js';

function createTempRsaKeyFile(): string {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-agent-test-'));
  const keyPath = path.join(tmpDir, 'private-key.pem');
  fs.writeFileSync(keyPath, privateKey, 'utf8');
  return keyPath;
}

/**
 * Integration tests for findInstallationForOwner.
 *
 * Exercises the real implementation (JWT creation, pagination loop,
 * owner matching) with stubbed HTTP responses.
 */
describe('findInstallationForOwner (integration)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates a valid JWT and sends correct headers', async () => {
    // Arrange
    const privateKeyPath = createTempRsaKeyFile();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => [
        {
          id: 42,
          account: { login: 'target-org' },
          target_type: 'Organization',
        },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    // Act
    await findInstallationForOwner({
      appId: '99999',
      privateKeyPath,
      owner: 'target-org',
    });

    // Assert — verify the request was well-formed
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      'https://api.github.com/app/installations?per_page=100',
    );
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/);
    expect(headers.Accept).toBe('application/vnd.github+json');
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
  });

  it('selects the correct installation among multiple orgs and users', async () => {
    // Arrange
    const privateKeyPath = createTempRsaKeyFile();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => [
          {
            id: 100,
            account: { login: 'personal-user' },
            target_type: 'User',
          },
          {
            id: 200,
            account: { login: 'getlarge' },
            target_type: 'Organization',
          },
          {
            id: 300,
            account: { login: 'innovation-system' },
            target_type: 'Organization',
          },
        ],
      })),
    );

    // Act
    const result = await findInstallationForOwner({
      appId: '12345',
      privateKeyPath,
      owner: 'innovation-system',
    });

    // Assert
    expect(result).toEqual({ installationId: '300' });
  });

  it('paginates across multiple pages to find the target installation', async () => {
    // Arrange
    const privateKeyPath = createTempRsaKeyFile();
    const fetchMock = vi.fn();

    // Page 1 — 100 installations, none matching
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'link'
            ? '<https://api.github.com/app/installations?per_page=100&page=2>; rel="next"'
            : null,
      },
      json: async () =>
        Array.from({ length: 100 }, (_, i) => ({
          id: 1000 + i,
          account: { login: `org-${i}` },
          target_type: 'Organization',
        })),
    });

    // Page 2 — target found
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => [
        {
          id: 5555,
          account: { login: 'innovation-system' },
          target_type: 'Organization',
        },
      ],
    });

    vi.stubGlobal('fetch', fetchMock);

    // Act
    const result = await findInstallationForOwner({
      appId: '12345',
      privateKeyPath,
      owner: 'innovation-system',
    });

    // Assert
    expect(result).toEqual({ installationId: '5555' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null after exhausting all pages without a match', async () => {
    // Arrange
    const privateKeyPath = createTempRsaKeyFile();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => [
          {
            id: 100,
            account: { login: 'some-other-org' },
            target_type: 'Organization',
          },
        ],
      })),
    );

    // Act
    const result = await findInstallationForOwner({
      appId: '12345',
      privateKeyPath,
      owner: 'nonexistent-org',
    });

    // Assert
    expect(result).toBeNull();
  });

  it('handles installations with null account gracefully', async () => {
    // Arrange
    const privateKeyPath = createTempRsaKeyFile();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => [
          { id: 100, account: null, target_type: 'Organization' },
          {
            id: 200,
            account: { login: 'target-org' },
            target_type: 'Organization',
          },
        ],
      })),
    );

    // Act
    const result = await findInstallationForOwner({
      appId: '12345',
      privateKeyPath,
      owner: 'target-org',
    });

    // Assert
    expect(result).toEqual({ installationId: '200' });
  });

  it('propagates GitHub API errors with status code', async () => {
    // Arrange
    const privateKeyPath = createTempRsaKeyFile();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        text: async () => '{"message":"Bad credentials"}',
      })),
    );

    // Act & Assert
    await expect(
      findInstallationForOwner({
        appId: '12345',
        privateKeyPath,
        owner: 'target-org',
      }),
    ).rejects.toThrow(/401/);
  });
});

/**
 * E2E test — hits the real GitHub API.
 *
 * Set these env vars to run:
 *   GITHUB_APP_ID         — the App's numeric ID
 *   GITHUB_APP_PEM_PATH   — absolute path to the App's PEM private key
 *   GITHUB_APP_OWNER      — an account/org where the App is installed
 */
const appId = process.env.GITHUB_APP_ID;
const pemPath = process.env.GITHUB_APP_PEM_PATH;
const owner = process.env.GITHUB_APP_OWNER;
const canRunE2E = appId && pemPath && owner;

describe.skipIf(!canRunE2E)('findInstallationForOwner (e2e)', () => {
  it('finds the installation for a known owner', async () => {
    const result = await findInstallationForOwner({
      appId: appId!,
      privateKeyPath: pemPath!,
      owner: owner!,
    });

    expect(result).not.toBeNull();
    expect(result!.installationId).toMatch(/^\d+$/);
  });

  it('returns null for a non-existent owner', async () => {
    const result = await findInstallationForOwner({
      appId: appId!,
      privateKeyPath: pemPath!,
      owner: 'this-org-definitely-does-not-exist-xyzzy-42',
    });

    expect(result).toBeNull();
  });

  it('matches owner case-insensitively', async () => {
    const result = await findInstallationForOwner({
      appId: appId!,
      privateKeyPath: pemPath!,
      owner: owner!.toUpperCase(),
    });

    expect(result).not.toBeNull();
    expect(result!.installationId).toMatch(/^\d+$/);
  });
});
