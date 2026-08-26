import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type MoltNetConfig,
  READ_WRITE_CAPABILITIES,
  readConfig,
  type SecretProvider,
  SecretProviderRegistry,
  writeConfig,
} from '@themoltnet/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ensureKeyringSecretReference } from './secret-storage.js';

const tempDirs: string[] = [];

function fakeKeyring(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const provider: SecretProvider = {
    name: 'os-keyring',
    capabilities: READ_WRITE_CAPABILITIES,
    read: vi.fn(async (key: string) => store.get(key) ?? null),
    write: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
  return {
    registry: new SecretProviderRegistry().register(provider),
    store,
    provider,
  };
}

function baseConfig(oauth2: MoltNetConfig['oauth2']): MoltNetConfig {
  return {
    identity_id: 'identity-123',
    registered_at: '2026-08-01T00:00:00Z',
    oauth2,
    keys: { public_key: 'pub', private_key: 'priv', fingerprint: 'fp' },
    endpoints: {
      api: 'https://api.themolt.net',
      mcp: 'https://mcp.themolt.net/mcp',
    },
  };
}

async function tempConfigDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'legreffier-secret-'));
  tempDirs.push(dir);
  return dir;
}

describe('ensureKeyringSecretReference', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })),
    );
  });

  it('stores plaintext in the keyring and writes only a reference to disk', async () => {
    const configDir = await tempConfigDir();
    const { registry, store } = fakeKeyring();
    const config = baseConfig({
      client_id: 'client-456',
      client_secret: 'plaintext-canary',
    });

    const secured = await ensureKeyringSecretReference(
      configDir,
      config,
      '',
      registry,
    );

    expect(secured.oauth2).toEqual({
      client_id: 'client-456',
      client_secret_ref: {
        provider: 'os-keyring',
        key: 'oauth2/identity-123/client-456',
      },
    });
    expect(store.get('oauth2/identity-123/client-456')).toBe(
      'plaintext-canary',
    );
    const raw = await readFile(join(configDir, 'moltnet.json'), 'utf8');
    expect(raw).not.toContain('plaintext-canary');
    expect(raw).not.toContain('"client_secret"');
    await expect(readConfig(configDir)).resolves.toEqual(secured);
  });

  it('prefers a freshly issued secret over stale plaintext in config', async () => {
    const configDir = await tempConfigDir();
    const { registry, store } = fakeKeyring();
    const config = baseConfig({
      client_id: 'client-456',
      client_secret: 'stale',
    });

    await ensureKeyringSecretReference(
      configDir,
      config,
      'issued-canary',
      registry,
    );

    expect(store.get('oauth2/identity-123/client-456')).toBe('issued-canary');
  });

  it('passes an existing os-keyring reference through after verifying presence', async () => {
    const configDir = await tempConfigDir();
    const { registry, provider } = fakeKeyring({
      'oauth2/identity-123/client-456': 'present',
    });
    const config = baseConfig({
      client_id: 'client-456',
      client_secret_ref: {
        provider: 'os-keyring',
        key: 'oauth2/identity-123/client-456',
      },
    });

    await expect(
      ensureKeyringSecretReference(configDir, config, '', registry),
    ).resolves.toBe(config);
    expect(provider.write).not.toHaveBeenCalled();
  });

  it('fails when an existing reference has no keyring value', async () => {
    const configDir = await tempConfigDir();
    const { registry } = fakeKeyring();
    const config = baseConfig({
      client_id: 'client-456',
      client_secret_ref: {
        provider: 'os-keyring',
        key: 'oauth2/identity-123/client-456',
      },
    });

    await expect(
      ensureKeyringSecretReference(configDir, config, '', registry),
    ).rejects.toThrow(/missing from the OS keyring/);
  });

  it('refuses to overwrite a different keyring value and leaves config untouched', async () => {
    const configDir = await tempConfigDir();
    const { registry, store } = fakeKeyring({
      'oauth2/identity-123/client-456': 'other-canary',
    });
    const config = baseConfig({
      client_id: 'client-456',
      client_secret: 'new-canary',
    });

    await expect(
      ensureKeyringSecretReference(configDir, config, '', registry),
    ).rejects.toThrow(/different secret/);
    expect(store.get('oauth2/identity-123/client-456')).toBe('other-canary');
    await expect(readConfig(configDir)).resolves.toBeNull();
  });

  it('rolls the keyring write back when config cannot be written', async () => {
    const configDir = await tempConfigDir();
    const { registry, store } = fakeKeyring();
    const config = baseConfig({
      client_id: 'client-456',
      client_secret: 'canary',
    });
    // Make the config path unwritable by turning it into a directory.
    await writeConfig(config, configDir);
    await rm(join(configDir, 'moltnet.json'));
    await mkdir(join(configDir, 'moltnet.json'));

    await expect(
      ensureKeyringSecretReference(configDir, config, '', registry),
    ).rejects.toThrow();
    expect(store.has('oauth2/identity-123/client-456')).toBe(false);
  });

  it('requires identity, client id, and a secret', async () => {
    const configDir = await tempConfigDir();
    const { registry } = fakeKeyring();

    await expect(
      ensureKeyringSecretReference(
        configDir,
        {
          ...baseConfig({ client_id: 'client-456', client_secret: 'x' }),
          identity_id: '',
        },
        '',
        registry,
      ),
    ).rejects.toThrow(/identity, client ID, or issued secret is missing/);
  });
});
