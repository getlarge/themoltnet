import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { oauth2SecretKey, readConfig, writeConfig } from '@themoltnet/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ensureKeyringSecretReference } from './secret-storage.js';

const tempDirs: string[] = [];

describe('ensureKeyringSecretReference', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })),
    );
  });

  it('moves plaintext out of config without exposing it', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'legreffier-secret-'));
    tempDirs.push(configDir);
    await writeConfig(
      {
        identity_id: 'identity-123',
        registered_at: '2026-08-01T00:00:00Z',
        oauth2: { client_id: 'client-456', client_secret: 'plaintext-canary' },
        keys: { public_key: 'pub', private_key: 'priv', fingerprint: 'fp' },
        endpoints: {
          api: 'https://api.themolt.net',
          mcp: 'https://mcp.themolt.net/mcp',
        },
      },
      configDir,
    );
    const config = await readConfig(configDir);
    if (!config) throw new Error('missing fixture config');

    const migrate = vi.fn(async (credentialsPath: string) => {
      expect(credentialsPath).toBe(join(configDir, 'moltnet.json'));
      const pending = await readConfig(configDir);
      if (!pending || !('client_secret' in pending.oauth2)) {
        throw new Error('missing plaintext migration input');
      }
      expect(pending.oauth2.client_secret).toBe('plaintext-canary');
      await writeConfig(
        {
          ...pending,
          oauth2: {
            client_id: pending.oauth2.client_id,
            client_secret_ref: {
              provider: 'os-keyring',
              key: oauth2SecretKey(
                pending.identity_id,
                pending.oauth2.client_id,
              ),
            },
          },
        },
        configDir,
      );
    });

    const secured = await ensureKeyringSecretReference(
      configDir,
      config,
      '',
      migrate,
    );

    expect(secured.oauth2).toEqual({
      client_id: 'client-456',
      client_secret_ref: {
        provider: 'os-keyring',
        key: 'oauth2/identity-123/client-456',
      },
    });
    expect(migrate).toHaveBeenCalledOnce();
    const raw = await readFile(join(configDir, 'moltnet.json'), 'utf8');
    expect(raw).not.toContain('plaintext-canary');
    expect(raw).not.toContain('"client_secret"');
  });
});
