import { describe, expect, it, vi } from 'vitest';

import {
  assertSecretReferenceBinding,
  EnvironmentSecretProvider,
  expectedSecretKey,
  githubAppPrivateKeyKey,
  identitySeedKey,
  oauth2SecretKey,
  READ_ONLY_CAPABILITIES,
  READ_WRITE_CAPABILITIES,
  SecretConflictError,
  SecretEnsureError,
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
      probe: async (key) => (key === 'oauth' ? 'present' : 'absent'),
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
    probe: async (key) => (store.has(key) ? 'present' : 'absent'),
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
    ).rejects.toBeInstanceOf(SecretEnsureError);
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
      probe: async () => {
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

  it('uses the provider probe rather than reading the value', async () => {
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

describe('SecretProviderRegistry.ensure concurrency and failure state', () => {
  const tick = () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });

  function slowProvider() {
    const store = new Map<string, string>();
    let writes = 0;
    const provider: SecretProvider = {
      name: 'slow',
      capabilities: READ_WRITE_CAPABILITIES,
      read: async (key) => {
        await tick();
        return store.get(key) ?? null;
      },
      write: async (key, value) => {
        writes += 1;
        await tick();
        store.set(key, value);
      },
      delete: async (key) => {
        store.delete(key);
      },
      probe: async (key) => (store.has(key) ? 'present' : 'absent'),
    };
    return { provider, store, writes: () => writes };
  }

  it('serializes same-value writers so only one write happens', async () => {
    const { provider, store, writes } = slowProvider();
    const registry = new SecretProviderRegistry().register(provider);
    const ref = { provider: 'slow', key: 'k' };

    const results = await Promise.all([
      registry.ensure(ref, 'v'),
      registry.ensure(ref, 'v'),
      registry.ensure(ref, 'v'),
    ]);

    expect(results).toEqual([
      { changed: true },
      { changed: false },
      { changed: false },
    ]);
    expect(writes()).toBe(1);
    expect(store.get('k')).toBe('v');
  });

  it('serializes different-value writers so the second conflicts instead of overwriting', async () => {
    const { provider, store } = slowProvider();
    const registry = new SecretProviderRegistry().register(provider);
    const ref = { provider: 'slow', key: 'k' };

    const [first, second] = await Promise.allSettled([
      registry.ensure(ref, 'first'),
      registry.ensure(ref, 'second'),
    ]);

    expect(first).toEqual({ status: 'fulfilled', value: { changed: true } });
    expect(second.status).toBe('rejected');
    expect((second as PromiseRejectedResult).reason).toBeInstanceOf(
      SecretConflictError,
    );
    expect(store.get('k')).toBe('first');
  });

  it('keeps independent keys concurrent', async () => {
    const { provider, writes } = slowProvider();
    const registry = new SecretProviderRegistry().register(provider);

    await Promise.all([
      registry.ensure({ provider: 'slow', key: 'a' }, 'v'),
      registry.ensure({ provider: 'slow', key: 'b' }, 'v'),
    ]);

    expect(writes()).toBe(2);
  });

  it('reports changed=true when the provider persisted the wrong value', async () => {
    const { provider, store } = slowProvider();
    provider.write = async (key) => {
      store.set(key, 'corrupted');
    };
    const registry = new SecretProviderRegistry().register(provider);

    const failure = await registry
      .ensure({ provider: 'slow', key: 'k' }, 'v')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SecretEnsureError);
    expect((failure as SecretEnsureError).changed).toBe(true);
    expect(String(failure)).not.toContain('corrupted');
  });

  it('reports changed=true when read-back itself fails after the write', async () => {
    const { provider } = slowProvider();
    let reads = 0;
    provider.read = async () => {
      reads += 1;
      if (reads === 1) return null;
      throw new Error('keyring locked');
    };
    const registry = new SecretProviderRegistry().register(provider);

    const failure = await registry
      .ensure({ provider: 'slow', key: 'k' }, 'v')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SecretEnsureError);
    expect((failure as SecretEnsureError).changed).toBe(true);
  });
});

it('exposes read-only capabilities on the environment provider', () => {
  expect(new EnvironmentSecretProvider(() => undefined).capabilities).toEqual({
    read: true,
    write: false,
    delete: false,
  });
});

describe('credential binding table', () => {
  it('derives stable keys per kind', () => {
    expect(
      expectedSecretKey('oauth2-client-secret', {
        identityId: 'id',
        clientId: 'c',
      }),
    ).toBe('oauth2/id/c');
    expect(
      expectedSecretKey('identity-seed', { fingerprint: '21FE-31DF' }),
    ).toBe('identity/21FE-31DF/seed');
    expect(identitySeedKey('fp')).toBe('identity/fp/seed');
  });

  it('accepts canonical keys, env variable names, and flattened file keys', () => {
    const ids = { fingerprint: 'fp' };
    for (const reference of [
      { provider: 'os-keyring', key: 'identity/fp/seed' },
      { provider: 'env', key: 'MOLTNET_PRIVATE_KEY' },
      { provider: 'file', key: 'identity/fp/seed' },
      { provider: 'file', key: 'identity.fp.seed' },
    ]) {
      expect(() =>
        assertSecretReferenceBinding('identity-seed', reference, ids),
      ).not.toThrow();
    }
  });

  it('rejects keys bound to another identity, wrong env names, and flattened keys outside file', () => {
    const ids = { fingerprint: 'fp' };
    for (const reference of [
      { provider: 'os-keyring', key: 'identity/other/seed' },
      { provider: 'env', key: 'MOLTNET_CLIENT_SECRET' },
      { provider: 'os-keyring', key: 'identity.fp.seed' },
    ]) {
      expect(() =>
        assertSecretReferenceBinding('identity-seed', reference, ids),
      ).toThrow(/not bound/);
    }
    expect(() =>
      assertSecretReferenceBinding(
        'identity-seed',
        { provider: 'os-keyring', key: 'identity/fp/seed' },
        {},
      ),
    ).toThrow(/fingerprint/);
  });
});

describe('github app private key binding', () => {
  it('derives the key from the app id and accepts env and flattened file forms', () => {
    expect(githubAppPrivateKeyKey('123')).toBe('github-app/123/private-key');
    expect(expectedSecretKey('github-app-private-key', { appId: '123' })).toBe(
      'github-app/123/private-key',
    );
    for (const reference of [
      { provider: 'os-keyring', key: 'github-app/123/private-key' },
      { provider: 'env', key: 'MOLTNET_GITHUB_APP_PRIVATE_KEY' },
      { provider: 'file', key: 'github-app.123.private-key' },
    ]) {
      expect(() =>
        assertSecretReferenceBinding('github-app-private-key', reference, {
          appId: '123',
        }),
      ).not.toThrow();
    }
    expect(() =>
      assertSecretReferenceBinding(
        'github-app-private-key',
        { provider: 'os-keyring', key: 'github-app/999/private-key' },
        { appId: '123' },
      ),
    ).toThrow(/not bound/);
  });
});
