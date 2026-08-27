import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cryptoService } from '@moltnet/crypto-service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CredentialResolutionError,
  resetLegacyCredentialWarnings,
  resolveAgentKey,
  resolveEnvSecretReference,
  resolveGitHubAppPrivateKey,
  resolveIdentitySeed,
  resolveOAuth2ClientSecret,
} from '../src/credential-resolver.js';
import {
  READ_ONLY_CAPABILITIES,
  type SecretProvider,
  SecretProviderRegistry,
} from '../src/secrets.js';

const SEED = 'nWGxne/9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A=';
const PUBLIC = 'ed25519:11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=';
const FP = '21FE-31DF-A154-A261';

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

describe('resolveIdentitySeed', () => {
  beforeEach(() => {
    resetLegacyCredentialWarnings();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('resolves a bound reference and checks it derives the configured public key', async () => {
    const registry = registryWith({ [`identity/${FP}/seed`]: SEED });

    await expect(
      resolveIdentitySeed(
        {
          keys: {
            public_key: PUBLIC,
            fingerprint: FP,
            private_key_ref: { provider: 'memory', key: `identity/${FP}/seed` },
          },
        },
        registry,
      ),
    ).resolves.toBe(SEED);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('returns legacy plaintext and warns exactly once per process', async () => {
    const registry = registryWith({});
    const config = {
      keys: { public_key: PUBLIC, fingerprint: FP, private_key: SEED },
    };

    await expect(resolveIdentitySeed(config, registry)).resolves.toBe(SEED);
    await expect(resolveIdentitySeed(config, registry)).resolves.toBe(SEED);
    expect(console.warn).toHaveBeenCalledTimes(1);
    const message = String(vi.mocked(console.warn).mock.calls[0][0]);
    expect(message).toMatch(/keys\.private_key.*secret provider reference/);
    expect(message).not.toContain(SEED);
  });

  it('rejects ambiguous, missing, unbound, and mismatching values with typed codes', async () => {
    const registry = registryWith({
      [`identity/${FP}/seed`]: 'AAAA',
      'identity/other/seed': SEED,
    });
    const base = { public_key: PUBLIC, fingerprint: FP };

    expect(
      (
        await failure(
          resolveIdentitySeed(
            {
              keys: {
                ...base,
                private_key: SEED,
                private_key_ref: {
                  provider: 'memory',
                  key: `identity/${FP}/seed`,
                },
              } as never,
            },
            registry,
          ),
        )
      ).code,
    ).toBe('ambiguous');
    expect(
      (await failure(resolveIdentitySeed({ keys: base as never }, registry)))
        .code,
    ).toBe('missing');
    expect(
      (
        await failure(
          resolveIdentitySeed(
            {
              keys: {
                ...base,
                private_key_ref: {
                  provider: 'memory',
                  key: 'identity/other/seed',
                },
              },
            },
            registry,
          ),
        )
      ).code,
    ).toBe('unbound');
    const invalid = await failure(
      resolveIdentitySeed(
        {
          keys: {
            ...base,
            private_key_ref: { provider: 'memory', key: `identity/${FP}/seed` },
          },
        },
        registry,
      ),
    );
    expect(invalid.code).toBe('invalid_value');
    expect(String(invalid)).not.toContain('AAAA');
  });

  it('rejects a well-formed seed that does not derive the configured public key', async () => {
    const other = await cryptoService.generateKeyPair();
    const registry = registryWith({
      [`identity/${FP}/seed`]: other.privateKey,
    });

    const error = await failure(
      resolveIdentitySeed(
        {
          keys: {
            public_key: PUBLIC,
            fingerprint: FP,
            private_key_ref: { provider: 'memory', key: `identity/${FP}/seed` },
          },
        },
        registry,
      ),
    );
    expect(error.code).toBe('invalid_value');
    expect(String(error)).not.toContain(other.privateKey);
  });
});

describe('resolveOAuth2ClientSecret', () => {
  beforeEach(() => {
    resetLegacyCredentialWarnings();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns a legacy client secret verbatim, including surrounding whitespace', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      resolveOAuth2ClientSecret(
        {
          identity_id: 'id',
          oauth2: { client_id: 'c', client_secret: '  spaced secret \n' },
        },
        registryWith({}),
      ),
    ).resolves.toBe('  spaced secret \n');
  });

  it('normalizes provider failures into value-free provider_failure errors', async () => {
    const provider: SecretProvider = {
      name: 'memory',
      capabilities: READ_ONLY_CAPABILITIES,
      read: async () => {
        throw new Error('backend said: leaked-canary');
      },
      probe: async () => 'inaccessible',
    };
    const registry = new SecretProviderRegistry().register(provider);

    const error = await failure(
      resolveOAuth2ClientSecret(
        {
          identity_id: 'id',
          oauth2: {
            client_id: 'c',
            client_secret_ref: { provider: 'memory', key: 'oauth2/id/c' },
          },
        },
        registry,
      ),
    );
    expect(error.code).toBe('provider_failure');
    expect(error.message).not.toContain('leaked-canary');
    expect((error.cause as Error).message).toContain('leaked-canary');
  });

  it('resolves a bound reference and warns once for plaintext', async () => {
    const registry = registryWith({ 'oauth2/id/c': 'secret' });

    await expect(
      resolveOAuth2ClientSecret(
        {
          identity_id: 'id',
          oauth2: {
            client_id: 'c',
            client_secret_ref: { provider: 'memory', key: 'oauth2/id/c' },
          },
        },
        registry,
      ),
    ).resolves.toBe('secret');
    await expect(
      resolveOAuth2ClientSecret(
        {
          identity_id: 'id',
          oauth2: { client_id: 'c', client_secret: 'plain' },
        },
        registry,
      ),
    ).resolves.toBe('plain');
    await expect(
      resolveOAuth2ClientSecret(
        {
          identity_id: 'id',
          oauth2: { client_id: 'c', client_secret: 'plain' },
        },
        registry,
      ),
    ).resolves.toBe('plain');
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('rejects an unbound reference with a typed code', async () => {
    const registry = registryWith({ 'oauth2/other/c': 'secret' });

    const error = await failure(
      resolveOAuth2ClientSecret(
        {
          identity_id: 'id',
          oauth2: {
            client_id: 'c',
            client_secret_ref: { provider: 'memory', key: 'oauth2/other/c' },
          },
        },
        registry,
      ),
    );
    expect(error.code).toBe('unbound');
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

  it('reads the legacy PEM file and warns once', async () => {
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
    expect(String(vi.mocked(console.warn).mock.calls[0][0])).toMatch(
      /github\.private_key_path/,
    );
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

describe('resolveAgentKey and resolveEnvSecretReference', () => {
  it('returns null without a reference and the key with a bound one', async () => {
    const registry = registryWith({ 'agent-key/id-1': ' ak_secret ' });

    await expect(
      resolveAgentKey({ identity_id: 'id-1' }, registry),
    ).resolves.toBeNull();
    await expect(
      resolveAgentKey(
        {
          identity_id: 'id-1',
          agent_key_ref: { provider: 'memory', key: 'agent-key/id-1' },
        },
        registry,
      ),
    ).resolves.toBe('ak_secret');
  });

  it('rejects unbound and empty agent keys with typed codes', async () => {
    const registry = registryWith({
      'agent-key/other': 'x',
      'agent-key/id-1': '   ',
    });
    expect(
      (
        await failure(
          resolveAgentKey(
            {
              identity_id: 'id-1',
              agent_key_ref: { provider: 'memory', key: 'agent-key/other' },
            },
            registry,
          ),
        )
      ).code,
    ).toBe('unbound');
    expect(
      (
        await failure(
          resolveAgentKey(
            {
              identity_id: 'id-1',
              agent_key_ref: { provider: 'memory', key: 'agent-key/id-1' },
            },
            registry,
          ),
        )
      ).code,
    ).toBe('invalid_value');
  });

  it('resolves environment references by shape only', async () => {
    const registry = registryWith({ 'anything/goes': 'value' });

    await expect(
      resolveEnvSecretReference('memory:anything/goes', registry),
    ).resolves.toBe('value');
    await expect(
      resolveEnvSecretReference('memory:missing', registry),
    ).rejects.toThrow(/no value/);
    await expect(
      resolveEnvSecretReference('not-a-ref', registry),
    ).rejects.toThrow(/<provider>:<key>/);
  });
});
