import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import keyringConformance from '../../../testdata/keyring-conformance.json';

const keyring = vi.hoisted(() => ({
  deleteCredential: vi.fn(),
  getPassword: vi.fn(),
  setPassword: vi.fn(),
  constructor: vi.fn(),
  withTarget: vi.fn(),
}));

vi.mock('@napi-rs/keyring', () => ({
  AsyncEntry: class {
    static withTarget(target: string, service: string, key: string) {
      keyring.withTarget(target, service, key);
      return new this(service, key);
    }

    constructor(service: string, key: string) {
      keyring.constructor(service, key);
    }

    getPassword = keyring.getPassword;
    setPassword = keyring.setPassword;
    deleteCredential = keyring.deleteCredential;
  },
}));

import {
  connect,
  createNodeSecretProviderRegistry,
  OSKeyringSecretProvider,
  resolveNodeOAuth2ClientSecret,
  windowsKeyringTarget,
} from '../src/node.js';

describe('OSKeyringSecretProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the stable service name for read, write, and delete', async () => {
    keyring.getPassword.mockResolvedValue('keyring-secret');
    keyring.setPassword.mockResolvedValue(undefined);
    keyring.deleteCredential.mockResolvedValue(true);
    const provider = new OSKeyringSecretProvider();
    const key = 'oauth2/identity-123/client-456';

    await expect(provider.read(key)).resolves.toBe('keyring-secret');
    await provider.write(key, 'new-secret');
    await provider.delete(key);

    expect(keyring.constructor).toHaveBeenCalledTimes(3);
    expect(keyring.constructor).toHaveBeenNthCalledWith(1, 'themolt.net', key);
    expect(keyring.setPassword).toHaveBeenCalledWith('new-secret');
    expect(keyring.deleteCredential).toHaveBeenCalledOnce();
  });

  it('uses the Go-compatible target for Windows credentials', async () => {
    const vector = keyringConformance.windows[0];
    keyring.getPassword.mockResolvedValue('keyring-secret');
    const provider = new OSKeyringSecretProvider('win32');

    await expect(provider.read(vector.key)).resolves.toBe('keyring-secret');

    expect(windowsKeyringTarget(vector.service, vector.key, 'win32')).toBe(
      vector.target,
    );
    expect(keyring.withTarget).toHaveBeenCalledWith(
      vector.target,
      vector.service,
      vector.key,
    );
  });

  it('fails deletion when the backend returns false and the secret remains', async () => {
    keyring.deleteCredential.mockResolvedValue(false);
    keyring.getPassword.mockResolvedValue('still-present');
    const provider = new OSKeyringSecretProvider();

    await expect(provider.delete('oauth2/identity/client')).rejects.toThrow(
      /not deleted/,
    );
  });

  it('accepts a false deletion result only after confirming absence', async () => {
    keyring.deleteCredential.mockResolvedValue(false);
    keyring.getPassword.mockResolvedValue(undefined);
    const provider = new OSKeyringSecretProvider();

    await expect(
      provider.delete('oauth2/identity/client'),
    ).resolves.toBeUndefined();
  });

  it('registers both env and OS-keyring providers for Node consumers', async () => {
    keyring.getPassword.mockResolvedValue('resolved-secret');
    const registry = createNodeSecretProviderRegistry();

    await expect(
      registry.resolve({
        provider: 'os-keyring',
        key: 'oauth2/identity-123/client-456',
      }),
    ).resolves.toBe('resolved-secret');
    expect(registry.get('env')).toBeDefined();
  });

  it('resolves referenced and plaintext OAuth2 secrets for Node consumers', async () => {
    keyring.getPassword.mockResolvedValue('resolved-secret');
    const referenced = {
      oauth2: {
        client_id: 'client',
        client_secret_ref: {
          provider: 'os-keyring',
          key: 'oauth2/identity/client',
        },
      },
    } as Parameters<typeof resolveNodeOAuth2ClientSecret>[0];
    const plaintext = {
      oauth2: { client_id: 'client', client_secret: 'legacy-secret' },
    } as Parameters<typeof resolveNodeOAuth2ClientSecret>[0];

    await expect(resolveNodeOAuth2ClientSecret(referenced)).resolves.toBe(
      'resolved-secret',
    );
    await expect(resolveNodeOAuth2ClientSecret(plaintext)).resolves.toBe(
      'legacy-secret',
    );
  });

  it('rejects ambiguous OAuth2 config loaded from untyped JSON', async () => {
    const ambiguous = {
      oauth2: {
        client_id: 'client',
        client_secret: 'legacy-secret',
        client_secret_ref: {
          provider: 'os-keyring',
          key: 'oauth2/identity/client',
        },
      },
    } as Parameters<typeof resolveNodeOAuth2ClientSecret>[0];

    await expect(resolveNodeOAuth2ClientSecret(ambiguous)).rejects.toThrow(
      /exactly one/,
    );
  });

  it('defaults Node connect to the OS-keyring provider', async () => {
    const configDir = join(tmpdir(), `sdk-node-connect-${Date.now()}`);
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'moltnet.json'),
      JSON.stringify({
        identity_id: 'identity',
        registered_at: '2026-01-01T00:00:00.000Z',
        oauth2: {
          client_id: 'client',
          client_secret_ref: {
            provider: 'os-keyring',
            key: 'oauth2/identity/client',
          },
        },
        keys: { public_key: '', private_key: '', fingerprint: '' },
        endpoints: { api: 'https://api.themolt.net', mcp: '' },
      }),
    );
    keyring.getPassword.mockResolvedValue('resolved-secret');

    await expect(
      connect({ configDir, autoToken: false }),
    ).resolves.toBeDefined();
    expect(keyring.getPassword).toHaveBeenCalledOnce();
  });
});
