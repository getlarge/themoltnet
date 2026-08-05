import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const keyring = vi.hoisted(() => ({
  read: vi.fn(),
  constructor: vi.fn(),
}));

vi.mock('@themoltnet/os-keyring', () => ({
  OSKeyringSecretProvider: class {
    readonly name = 'os-keyring';

    constructor(platform: NodeJS.Platform) {
      keyring.constructor(platform);
    }

    read = keyring.read;
    write = vi.fn();
    delete = vi.fn();
  },
  windowsKeyringTarget: vi.fn(),
}));

import {
  connect,
  createNodeSecretProviderRegistry,
  resolveNodeOAuth2ClientSecret,
  windowsKeyringTarget,
} from '../src/node.js';

const keyringConformance = JSON.parse(
  readFileSync(
    new URL('../../../testdata/keyring-conformance.json', import.meta.url),
    'utf8',
  ),
) as {
  windows: Array<{ service: string; key: string; target: string }>;
};

describe('Node secret providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    keyring.read.mockResolvedValue(null);
  });

  it('registers both env and a lazy OS-keyring provider for Node consumers', async () => {
    const registry = createNodeSecretProviderRegistry('linux');

    expect(registry.get('env')).toBeDefined();
    expect(keyring.constructor).not.toHaveBeenCalled();

    keyring.read.mockResolvedValue('resolved-secret');

    await expect(
      registry.resolve({
        provider: 'os-keyring',
        key: 'oauth2/identity-123/client-456',
      }),
    ).resolves.toBe('resolved-secret');
    expect(keyring.constructor).toHaveBeenCalledWith('linux');
  });

  it('resolves referenced and plaintext OAuth2 secrets for Node consumers', async () => {
    keyring.read.mockResolvedValue('resolved-secret');
    const referenced = {
      identity_id: 'identity',
      oauth2: {
        client_id: 'client',
        client_secret_ref: {
          provider: 'os-keyring',
          key: 'oauth2/identity/client',
        },
      },
    } as unknown as Parameters<typeof resolveNodeOAuth2ClientSecret>[0];
    const plaintext = {
      oauth2: { client_id: 'client', client_secret: 'legacy-secret' },
    } as unknown as Parameters<typeof resolveNodeOAuth2ClientSecret>[0];

    const registry = createNodeSecretProviderRegistry('linux');
    await expect(
      resolveNodeOAuth2ClientSecret(referenced, registry),
    ).resolves.toBe('resolved-secret');
    await expect(
      resolveNodeOAuth2ClientSecret(plaintext, registry),
    ).resolves.toBe('legacy-secret');
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
    } as unknown as Parameters<typeof resolveNodeOAuth2ClientSecret>[0];

    await expect(resolveNodeOAuth2ClientSecret(ambiguous)).rejects.toThrow(
      /exactly one/,
    );
  });

  it('connects with the Node OS-keyring provider', async () => {
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
    keyring.read.mockResolvedValue('resolved-secret');

    await expect(
      connect({
        configDir,
        autoToken: false,
        secretProviders: createNodeSecretProviderRegistry('linux'),
      }),
    ).resolves.toBeDefined();
    expect(keyring.read).toHaveBeenCalledWith('oauth2/identity/client');
  });

  it('uses the shared Windows credential target format', () => {
    for (const vector of keyringConformance.windows) {
      expect(windowsKeyringTarget(vector.service, vector.key, 'win32')).toBe(
        vector.target,
      );
    }
    expect(windowsKeyringTarget('service', 'key', 'linux')).toBeUndefined();
  });
});
