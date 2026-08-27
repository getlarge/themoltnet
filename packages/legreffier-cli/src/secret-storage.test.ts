import { chmod, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type MoltNetConfig,
  READ_WRITE_CAPABILITIES,
  readConfig,
  type SecretProbeResult,
  type SecretProvider,
  SecretProviderRegistry,
  writeConfig,
} from '@themoltnet/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ensureKeyringSecretReference } from './secret-storage.js';

const tempDirs: string[] = [];

function fakeKeyring(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const read = vi.fn(async (key: string) => store.get(key) ?? null);
  const write = vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  });
  const remove = vi.fn(async (key: string) => {
    store.delete(key);
  });
  const probe = vi.fn(
    async (key: string): Promise<SecretProbeResult> =>
      store.has(key) ? 'present' : 'absent',
  );
  const provider: SecretProvider = {
    name: 'os-keyring',
    capabilities: READ_WRITE_CAPABILITIES,
    read,
    write,
    delete: remove,
    probe,
  };
  return {
    registry: new SecretProviderRegistry().register(provider),
    store,
    provider: { read, write, delete: remove, probe },
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

  it('reports an inaccessible keyring differently from a missing secret', async () => {
    const configDir = await tempConfigDir();
    const { registry, provider } = fakeKeyring();
    provider.probe.mockResolvedValue('inaccessible');
    const config = baseConfig({
      client_id: 'client-456',
      client_secret_ref: {
        provider: 'os-keyring',
        key: 'oauth2/identity-123/client-456',
      },
    });

    await expect(
      ensureKeyringSecretReference(configDir, config, '', registry),
    ).rejects.toThrow(/could not be accessed/);
  });

  it('rolls back a write whose verification failed and never leaks the value', async () => {
    const configDir = await tempConfigDir();
    const { registry, store, provider } = fakeKeyring();
    provider.write.mockImplementation(async (key) => {
      store.set(key, 'corrupted-canary');
    });
    const config = baseConfig({
      client_id: 'client-456',
      client_secret: 'plaintext-canary',
    });

    const failure = await ensureKeyringSecretReference(
      configDir,
      config,
      '',
      registry,
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toMatch(/canary/);
    expect(provider.delete).toHaveBeenCalledWith(
      'oauth2/identity-123/client-456',
    );
    expect(store.has('oauth2/identity-123/client-456')).toBe(false);
    await expect(readConfig(configDir)).resolves.toBeNull();
  });

  it('surfaces a rollback failure instead of hiding an orphaned credential', async () => {
    const configDir = await tempConfigDir();
    const { registry, provider } = fakeKeyring();
    provider.delete.mockRejectedValue(new Error('keyring locked'));
    const config = baseConfig({
      client_id: 'client-456',
      client_secret: 'canary',
    });
    await writeConfig(config, configDir);
    await rm(join(configDir, 'moltnet.json'));
    await mkdir(join(configDir, 'moltnet.json'));

    await expect(
      ensureKeyringSecretReference(configDir, config, '', registry),
    ).rejects.toThrow(/remove it manually/);
  });

  it('keeps the keyring entry when a persisted config already references it', async () => {
    const configDir = await tempConfigDir();
    const { registry, store } = fakeKeyring();
    const reference = {
      provider: 'os-keyring',
      key: 'oauth2/identity-123/client-456',
    };
    await writeConfig(
      baseConfig({ client_id: 'client-456', client_secret_ref: reference }),
      configDir,
    );
    // A read-only directory fails the temp-file write while the persisted
    // config that references the key stays readable.
    await chmod(configDir, 0o500);
    try {
      await expect(
        ensureKeyringSecretReference(
          configDir,
          baseConfig({ client_id: 'client-456', client_secret: 'canary' }),
          '',
          registry,
        ),
      ).rejects.toThrow(/Could not write/);
      expect(store.get(reference.key)).toBe('canary');
    } finally {
      await chmod(configDir, 0o700);
    }
  });
});
