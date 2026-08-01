import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readConfig, writeConfig } from '@themoltnet/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureKeyringSecretReference } from './secret-storage.js';

const keyring = vi.hoisted(() => new Map<string, string>());
const tempDirs: string[] = [];

vi.mock('@themoltnet/sdk/node', () => ({
  createNodeSecretProviderRegistry: () => ({
    get: () => ({
      read: async (key: string) => keyring.get(key) ?? null,
      write: async (key: string, value: string) => {
        keyring.set(key, value);
      },
      delete: async (key: string) => {
        keyring.delete(key);
      },
    }),
  }),
}));

describe('ensureKeyringSecretReference', () => {
  beforeEach(() => keyring.clear());
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

    const secured = await ensureKeyringSecretReference(configDir, config);

    expect(secured.oauth2).toEqual({
      client_id: 'client-456',
      client_secret_ref: {
        provider: 'os-keyring',
        key: 'oauth2/identity-123/client-456',
      },
    });
    expect(keyring.get('oauth2/identity-123/client-456')).toBe(
      'plaintext-canary',
    );
    const raw = await readFile(join(configDir, 'moltnet.json'), 'utf8');
    expect(raw).not.toContain('plaintext-canary');
    expect(raw).not.toContain('"client_secret"');
  });
});
