import { describe, expect, it, vi } from 'vitest';

import {
  EnvironmentSecretProvider,
  oauth2SecretKey,
  READ_ONLY_CAPABILITIES,
  READ_WRITE_CAPABILITIES,
  SecretConflictError,
  type SecretProvider,
  SecretProviderReadOnlyError,
  SecretProviderRegistry,
} from '../src/secrets.js';

describe('secret providers', () => {
  it('resolves a registered provider without exposing storage details', async () => {
    const provider: SecretProvider = {
      name: 'memory',
      capabilities: READ_ONLY_CAPABILITIES,
      read: async (key) => (key === 'oauth' ? 'canary-secret' : null),
    };
    const registry = new SecretProviderRegistry().register(provider);

    await expect(
      registry.resolve({ provider: 'memory', key: 'oauth' }),
    ).resolves.toBe('canary-secret');
  });

  it('reads environment secrets without exposing mutation methods', async () => {
    const provider = new EnvironmentSecretProvider((key) =>
      key === 'MOLTNET_CLIENT_SECRET' ? 'environment-secret' : undefined,
    );

    await expect(provider.read('MOLTNET_CLIENT_SECRET')).resolves.toBe(
      'environment-secret',
    );
    expect('write' in provider).toBe(false);
    expect('delete' in provider).toBe(false);
  });

  it('uses a stable OAuth2 key shape', () => {
    expect(oauth2SecretKey('identity-123', 'client-456')).toBe(
      'oauth2/identity-123/client-456',
    );
  });
});

function memoryProvider(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const provider: SecretProvider = {
    name: 'memory',
    capabilities: READ_WRITE_CAPABILITIES,
    read: async (key) => store.get(key) ?? null,
    write: async (key, value) => {
      store.set(key, value);
    },
    delete: async (key) => {
      store.delete(key);
    },
  };
  return { provider, store };
}

describe('SecretProviderRegistry.ensure', () => {
  it('writes an absent value, verifies it, and reports changed', async () => {
    const { provider, store } = memoryProvider();
    const registry = new SecretProviderRegistry().register(provider);

    await expect(
      registry.ensure({ provider: 'memory', key: 'k' }, 'v1'),
    ).resolves.toEqual({ changed: true });
    expect(store.get('k')).toBe('v1');
  });

  it('is a no-op when the same value is already stored', async () => {
    const { provider } = memoryProvider({ k: 'v1' });
    const registry = new SecretProviderRegistry().register(provider);

    await expect(
      registry.ensure({ provider: 'memory', key: 'k' }, 'v1'),
    ).resolves.toEqual({ changed: false });
  });

  it('refuses to overwrite a different value without leaking either', async () => {
    const { provider, store } = memoryProvider({ k: 'old-canary' });
    const registry = new SecretProviderRegistry().register(provider);

    const failure = await registry
      .ensure({ provider: 'memory', key: 'k' }, 'new-canary')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SecretConflictError);
    expect(String(failure)).not.toContain('canary');
    expect(store.get('k')).toBe('old-canary');
  });

  it('fails verification when the provider stored something else', async () => {
    const { provider } = memoryProvider();
    provider.write = async () => undefined; // silently drops the write
    const registry = new SecretProviderRegistry().register(provider);

    await expect(
      registry.ensure({ provider: 'memory', key: 'k' }, 'v1'),
    ).rejects.toThrow(/stored value does not match/);
  });

  it('rejects empty values and read-only providers with typed errors', async () => {
    const { provider } = memoryProvider();
    const registry = new SecretProviderRegistry()
      .register(provider)
      .register(new EnvironmentSecretProvider(() => undefined));

    await expect(
      registry.ensure({ provider: 'memory', key: 'k' }, ''),
    ).rejects.toThrow(/value is required/);
    await expect(
      registry.ensure({ provider: 'env', key: 'MOLTNET_CLIENT_SECRET' }, 'v'),
    ).rejects.toBeInstanceOf(SecretProviderReadOnlyError);
  });
});

describe('SecretProviderRegistry.delete and probe', () => {
  it('deletes through writable providers and rejects read-only ones', async () => {
    const { provider, store } = memoryProvider({ k: 'v' });
    const registry = new SecretProviderRegistry()
      .register(provider)
      .register(new EnvironmentSecretProvider(() => 'x'));

    await registry.delete({ provider: 'memory', key: 'k' });
    expect(store.has('k')).toBe(false);
    await expect(
      registry.delete({ provider: 'env', key: 'MOLTNET_CLIENT_SECRET' }),
    ).rejects.toBeInstanceOf(SecretProviderReadOnlyError);
  });

  it('probes value-free: present, absent, inaccessible', async () => {
    const { provider } = memoryProvider({ k: 'v' });
    const broken: SecretProvider = {
      name: 'broken',
      capabilities: READ_ONLY_CAPABILITIES,
      read: async () => {
        throw new Error('locked');
      },
    };
    const registry = new SecretProviderRegistry()
      .register(provider)
      .register(broken);

    await expect(
      registry.probe({ provider: 'memory', key: 'k' }),
    ).resolves.toBe('present');
    await expect(
      registry.probe({ provider: 'memory', key: 'missing' }),
    ).resolves.toBe('absent');
    await expect(
      registry.probe({ provider: 'broken', key: 'k' }),
    ).resolves.toBe('inaccessible');
    await expect(
      registry.probe({ provider: 'unregistered', key: 'k' }),
    ).resolves.toBe('inaccessible');
  });

  it('prefers a provider-supplied probe over reading the value', async () => {
    const read = vi.fn();
    const provider: SecretProvider = {
      name: 'probing',
      capabilities: READ_ONLY_CAPABILITIES,
      read,
      probe: async () => 'present',
    };
    const registry = new SecretProviderRegistry().register(provider);

    await expect(
      registry.probe({ provider: 'probing', key: 'k' }),
    ).resolves.toBe('present');
    expect(read).not.toHaveBeenCalled();
  });
});

it('exposes read-only capabilities on the environment provider', () => {
  expect(new EnvironmentSecretProvider(() => undefined).capabilities).toEqual({
    read: true,
    write: false,
    delete: false,
  });
});
