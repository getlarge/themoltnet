import { describe, expect, it } from 'vitest';

import {
  EnvironmentSecretProvider,
  oauth2SecretKey,
  type SecretProvider,
  SecretProviderRegistry,
} from '../src/secrets.js';

describe('secret providers', () => {
  it('resolves a registered provider without exposing storage details', async () => {
    const provider: SecretProvider = {
      name: 'memory',
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
