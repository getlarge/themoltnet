import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getInstallationToken } from '../src/token.js';

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

describe('getInstallationToken', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('should throw when private key file does not exist', async () => {
    // Arrange
    const opts = {
      appId: '12345',
      privateKeyPath: '/nonexistent/path/to/private-key.pem',
      installationId: '67890',
    };

    // Act & Assert
    await expect(getInstallationToken(opts)).rejects.toThrow(/ENOENT/);
  });

  it('should create a JWT and call the GitHub API', async () => {
    // Arrange
    const privateKeyPath = createTempRsaKeyFile();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 201,
        json: async () => ({
          token: 'ghs_test123',
          expires_at: '2026-02-16T20:00:00Z',
        }),
      })),
    );

    // Act
    await getInstallationToken({
      appId: '12345',
      privateKeyPath,
      installationId: '67890',
    });

    // Assert
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/app/installations/67890/access_tokens');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer .+/);
  });

  it('should return token and expiresAt on success', async () => {
    // Arrange
    const privateKeyPath = createTempRsaKeyFile();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 201,
        json: async () => ({
          token: 'ghs_test123',
          expires_at: '2026-02-16T20:00:00Z',
        }),
      })),
    );

    // Act
    const result = await getInstallationToken({
      appId: '12345',
      privateKeyPath,
      installationId: '67890',
    });

    // Assert
    expect(result).toEqual({
      token: 'ghs_test123',
      expiresAt: '2026-02-16T20:00:00Z',
    });
  });

  it('should throw on non-ok response', async () => {
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
      getInstallationToken({
        appId: '12345',
        privateKeyPath,
        installationId: '67890',
      }),
    ).rejects.toThrow('GitHub API error (401)');
  });
});
