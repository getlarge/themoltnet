import { generateKeyPairSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { credentialHelper } from '../src/credential-helper.js';

describe('credentialHelper', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'moltnet-cred-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should throw when no config found', async () => {
    // Arrange — empty temp dir, no moltnet.json

    // Act & Assert
    await expect(credentialHelper(tempDir)).rejects.toThrow('No config found');
  });

  it('should throw when no github section in config', async () => {
    // Arrange — config without github section
    const config = {
      identity_id: 'test-agent',
      registered_at: '2025-01-01T00:00:00.000Z',
      oauth2: {
        client_id: 'test-client',
        client_secret: 'test-secret',
      },
      keys: {
        public_key: 'ed25519:test',
        private_key: 'test',
        fingerprint: 'test',
      },
      endpoints: {
        api: 'https://api.themolt.net',
        mcp: 'https://mcp.themolt.net/mcp',
      },
    };
    await writeFile(
      join(tempDir, 'moltnet.json'),
      JSON.stringify(config, null, 2),
    );

    // Act & Assert
    await expect(credentialHelper(tempDir)).rejects.toThrow(
      'GitHub App not configured',
    );
  });

  it('mints a token from github.private_key_ref and caches in the config dir', async () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    vi.stubEnv('MOLTNET_GITHUB_APP_PRIVATE_KEY', privateKey);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 201,
        json: async () => ({
          token: 'ghs_ref',
          expires_at: '2099-01-01T00:00:00Z',
        }),
      })),
    );
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    await writeFile(
      join(tempDir, 'moltnet.json'),
      JSON.stringify({
        identity_id: 'test-agent',
        registered_at: '2025-01-01T00:00:00.000Z',
        oauth2: { client_id: 'c', client_secret: 's' },
        keys: {
          public_key: 'ed25519:test',
          private_key: 'test',
          fingerprint: 'fp',
        },
        endpoints: {
          api: 'https://api.themolt.net',
          mcp: 'https://mcp.themolt.net/mcp',
        },
        github: {
          app_id: '123',
          installation_id: '456',
          private_key_ref: {
            provider: 'env',
            key: 'MOLTNET_GITHUB_APP_PRIVATE_KEY',
          },
        },
      }),
    );

    try {
      await credentialHelper(tempDir);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }

    expect(writes.join('')).toContain('password=ghs_ref');
    expect(existsSync(join(tempDir, 'gh-token-cache.json'))).toBe(true);
  });
});
