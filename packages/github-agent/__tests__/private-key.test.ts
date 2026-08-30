import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertSecretReferenceBoundTo,
  CredentialResolutionError,
  READ_ONLY_CAPABILITIES,
  resetLegacyCredentialWarnings,
  type SecretProvider,
  SecretProviderRegistry,
} from '@themoltnet/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GITHUB_APP_PRIVATE_KEY_ENV,
  githubAppPrivateKeyBinding,
  githubAppPrivateKeyKey,
  resolveGitHubAppPrivateKey,
} from '../src/private-key.js';

function registryWith(values: Record<string, string>) {
  const provider: SecretProvider = {
    name: 'memory',
    capabilities: READ_ONLY_CAPABILITIES,
    read: async (key) => values[key] ?? null,
    probe: async (key) => (key in values ? 'present' : 'absent'),
  };
  return new SecretProviderRegistry().register(provider);
}

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CredentialResolutionError);
  return error as CredentialResolutionError;
}

describe('github app private key binding', () => {
  it('derives the key from the app id and accepts env and flattened file forms', () => {
    expect(githubAppPrivateKeyKey('123')).toBe('github-app/123/private-key');
    const binding = githubAppPrivateKeyBinding('123');
    expect(binding.canonicalKey).toBe('github-app/123/private-key');
    expect(binding.envKey).toBe(GITHUB_APP_PRIVATE_KEY_ENV);
    for (const reference of [
      { provider: 'os-keyring', key: 'github-app/123/private-key' },
      { provider: 'env', key: 'MOLTNET_GITHUB_APP_PRIVATE_KEY' },
      { provider: 'file', key: 'github-app.123.private-key' },
    ]) {
      expect(() =>
        assertSecretReferenceBoundTo(reference, binding),
      ).not.toThrow();
    }
    expect(() =>
      assertSecretReferenceBoundTo(
        { provider: 'os-keyring', key: 'github-app/999/private-key' },
        binding,
      ),
    ).toThrow(/not bound/);
    expect(() =>
      assertSecretReferenceBoundTo(
        { provider: 'env', key: 'OTHER_VAR' },
        binding,
      ),
    ).toThrow(/not bound/);
    expect(() => githubAppPrivateKeyBinding(' ')).toThrow(/app_id/);
  });
});

describe('resolveGitHubAppPrivateKey', () => {
  const tempDirs: string[] = [];
  const rsaPem = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  }).privateKey;
  const ed25519Pem = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  }).privateKey;

  beforeEach(() => {
    resetLegacyCredentialWarnings();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
    );
  });

  it('resolves a bound reference to an RSA PEM', async () => {
    const registry = registryWith({ 'github-app/123/private-key': rsaPem });

    await expect(
      resolveGitHubAppPrivateKey(
        {
          github: {
            app_id: '123',
            installation_id: '456',
            private_key_ref: {
              provider: 'memory',
              key: 'github-app/123/private-key',
            },
          },
        },
        registry,
      ),
    ).resolves.toBe(rsaPem);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('reads the legacy PEM file and warns once, naming config migrate', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moltnet-pem-'));
    tempDirs.push(dir);
    await writeFile(join(dir, 'app.pem'), rsaPem, { mode: 0o600 });
    const config = {
      github: {
        app_id: '123',
        installation_id: '456',
        private_key_path: join(dir, 'app.pem'),
      },
    };
    const registry = registryWith({});

    await expect(resolveGitHubAppPrivateKey(config, registry)).resolves.toBe(
      rsaPem,
    );
    await expect(resolveGitHubAppPrivateKey(config, registry)).resolves.toBe(
      rsaPem,
    );
    expect(console.warn).toHaveBeenCalledTimes(1);
    const message = String(vi.mocked(console.warn).mock.calls[0][0]);
    expect(message).toMatch(/github\.private_key_path/);
    expect(message).toContain("run 'moltnet config migrate'");
  });

  it('rejects non-RSA or unparsable values without leaking them', async () => {
    const registry = registryWith({
      'github-app/123/private-key': ed25519Pem,
      'github-app/124/private-key': 'not-a-pem',
    });
    const notRsa = await failure(
      resolveGitHubAppPrivateKey(
        {
          github: {
            app_id: '123',
            installation_id: '456',
            private_key_ref: {
              provider: 'memory',
              key: 'github-app/123/private-key',
            },
          },
        },
        registry,
      ),
    );
    expect(notRsa.kind).toBe('github-app-private-key');
    expect(notRsa.code).toBe('invalid_value');
    expect(String(notRsa)).not.toContain('PRIVATE KEY-----');
    const garbage = await failure(
      resolveGitHubAppPrivateKey(
        {
          github: {
            app_id: '124',
            installation_id: '456',
            private_key_ref: {
              provider: 'memory',
              key: 'github-app/124/private-key',
            },
          },
        },
        registry,
      ),
    );
    expect(garbage.code).toBe('invalid_value');
    expect(String(garbage)).not.toContain('not-a-pem');
  });

  it('normalizes provider failures into value-free provider_failure errors', async () => {
    const registry = new SecretProviderRegistry().register({
      name: 'memory',
      capabilities: READ_ONLY_CAPABILITIES,
      read: async () => {
        throw new Error('keychain locked at /Users/x/secret-canary');
      },
      probe: async () => 'inaccessible' as const,
    });
    const error = await failure(
      resolveGitHubAppPrivateKey(
        {
          github: {
            app_id: '123',
            installation_id: '456',
            private_key_ref: {
              provider: 'memory',
              key: 'github-app/123/private-key',
            },
          },
        },
        registry,
      ),
    );
    expect(error.code).toBe('provider_failure');
    expect(String(error)).not.toContain('secret-canary');
    expect(String((error.cause as Error).message)).toContain('secret-canary');
  });

  it('rejects missing, ambiguous, and unbound configurations', async () => {
    const registry = registryWith({ 'github-app/999/private-key': rsaPem });
    expect((await failure(resolveGitHubAppPrivateKey({}, registry))).code).toBe(
      'missing',
    );
    expect(
      (
        await failure(
          resolveGitHubAppPrivateKey(
            {
              github: {
                app_id: '123',
                installation_id: '456',
                private_key_path: '/tmp/x.pem',
                private_key_ref: { provider: 'memory', key: 'k' },
              } as never,
            },
            registry,
          ),
        )
      ).code,
    ).toBe('ambiguous');
    expect(
      (
        await failure(
          resolveGitHubAppPrivateKey(
            {
              github: {
                app_id: '123',
                installation_id: '456',
                private_key_ref: {
                  provider: 'memory',
                  key: 'github-app/999/private-key',
                },
              },
            },
            registry,
          ),
        )
      ).code,
    ).toBe('unbound');
  });
});
