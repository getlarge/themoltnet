import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const keyring = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  delete: vi.fn(),
  probe: vi.fn(),
  constructor: vi.fn(),
}));

vi.mock('@themoltnet/os-keyring', () => ({
  OSKeyringSecretProvider: class {
    readonly name = 'os-keyring';
    readonly capabilities = { read: true, write: true, delete: true };

    constructor(
      platform: NodeJS.Platform,
      _loader?: unknown,
      service?: string,
    ) {
      keyring.constructor(platform, service);
    }

    read = keyring.read;
    write = keyring.write;
    delete = keyring.delete;
    probe = keyring.probe;
  },
  windowsKeyringTarget: vi.fn(),
}));

import {
  connect,
  createNodeSecretProviderRegistry,
  resolveNodeOAuth2ClientSecret,
  storeSecretService,
  windowsKeyringTarget,
} from '../src/node.js';

const keyringConformance = JSON.parse(
  readFileSync(
    new URL('../../../test-fixtures/keyring-conformance.json', import.meta.url),
    'utf8',
  ),
) as {
  windows: Array<{ service: string; key: string; target: string }>;
};

describe('Node secret providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    keyring.read.mockResolvedValue(null);
    keyring.write.mockResolvedValue(undefined);
    keyring.delete.mockResolvedValue(undefined);
    keyring.probe.mockResolvedValue('absent');
    vi.stubEnv('MOLTNET_AGENT_KEY', '');
    vi.stubEnv('MOLTNET_API_URL', '');
    vi.stubEnv('MOLTNET_CLIENT_ID', '');
    vi.stubEnv('MOLTNET_CLIENT_SECRET', '');
    vi.stubEnv('MOLTNET_CREDENTIALS_PATH', '');
  });

  afterEach(() => vi.unstubAllEnvs());

  it('does not resolve an invalid store for env-only registry users', async () => {
    vi.stubEnv('MOLTNET_HOME', '');
    vi.stubEnv('ENV_ONLY', 'env-value');
    const registry = createNodeSecretProviderRegistry('linux');
    await expect(
      registry.resolve({ provider: 'env', key: 'ENV_ONLY' }),
    ).resolves.toBe('env-value');
    await expect(
      registry.resolve({ provider: 'os-keyring', key: 'test' }),
    ).rejects.toThrow(/store root/);
  });

  it.each(['ambient', 'options'] as const)(
    'captures the original default store under a worker HOME (%s)',
    async (selection) => {
      const original = join(tmpdir(), 'original-home', '.config', 'moltnet');
      const worker = join(tmpdir(), 'worker-home');
      vi.stubEnv('HOME', worker);
      vi.stubEnv('USERPROFILE', worker);
      vi.stubEnv('MOLTNET_AGENT_SERVER_ROOT', undefined);
      vi.stubEnv('MOLTNET_HOME', original);
      vi.stubEnv('MOLTNET_DEFAULT_STORE_ROOT', original);
      const env = {
        MOLTNET_HOME: original,
        MOLTNET_DEFAULT_STORE_ROOT: original,
      };
      const registry = createNodeSecretProviderRegistry({
        platform: 'linux',
        ...(selection === 'options' ? { store: { env, home: worker } } : {}),
      });
      // Lazy access must keep the complete selection captured at construction.
      vi.stubEnv('MOLTNET_DEFAULT_STORE_ROOT', join(tmpdir(), 'changed'));
      env.MOLTNET_DEFAULT_STORE_ROOT = join(tmpdir(), 'changed');
      await registry.get('os-keyring')?.read('identity/same/seed');
      expect(keyring.constructor).toHaveBeenCalledWith('linux', 'themolt.net');
    },
  );

  it('captures the legacy store alias before lazy initialization', async () => {
    vi.stubEnv('MOLTNET_HOME', undefined);
    vi.stubEnv('MOLTNET_AGENT_SERVER_ROOT', '/missing-keyring-legacy-store');
    const expected = storeSecretService();
    const registry = createNodeSecretProviderRegistry('linux');
    vi.stubEnv('MOLTNET_AGENT_SERVER_ROOT', '/different-keyring-legacy-store');
    await registry.get('os-keyring')?.read('identity/same/seed');
    expect(keyring.constructor.mock.calls[0]?.[1]).toBe(expected);
  });

  it('registers both env and a lazy OS-keyring provider for Node consumers', async () => {
    const registry = createNodeSecretProviderRegistry('linux');

    expect(registry.get('env')).toBeDefined();
    const file = registry.get('file');
    expect(file?.name).toBe('file');
    expect(file?.capabilities).toEqual({
      read: true,
      write: false,
      delete: false,
    });
    expect(keyring.constructor).not.toHaveBeenCalled();

    keyring.read.mockResolvedValue('resolved-secret');

    await expect(
      registry.resolve({
        provider: 'os-keyring',
        key: 'oauth2/identity-123/client-456',
      }),
    ).resolves.toBe('resolved-secret');
    expect(keyring.constructor).toHaveBeenCalledWith('linux', 'themolt.net');
  });

  it('captures a separate keyring namespace for each selected store', async () => {
    keyring.read.mockResolvedValue('fixture-only-secret');
    vi.stubEnv('MOLTNET_HOME', join(tmpdir(), 'store-a'));
    const a = createNodeSecretProviderRegistry('linux');
    vi.stubEnv('MOLTNET_HOME', join(tmpdir(), 'store-b'));
    const b = createNodeSecretProviderRegistry('linux');
    await a.resolve({ provider: 'os-keyring', key: 'identity/same/seed' });
    await b.resolve({ provider: 'os-keyring', key: 'identity/same/seed' });
    const [first, second] = keyring.constructor.mock.calls;
    expect(first?.[1]).toMatch(/^themolt.net\/store\/[a-f0-9]{64}$/);
    expect(second?.[1]).not.toBe(first?.[1]);
  });

  it('resolves referenced and plaintext OAuth2 secrets for Node consumers', async () => {
    keyring.read.mockResolvedValue('resolved-secret');
    const referenced = {
      subject_id: 'identity',
      subject_type: 'agent',
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
        subject_id: 'identity',
        subject_type: 'agent',
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
  it('forwards write, delete, and probe to the lazily loaded keyring', async () => {
    const registry = createNodeSecretProviderRegistry('linux');
    const provider = registry.get('os-keyring');
    if (!provider) throw new Error('os-keyring not registered');
    keyring.read.mockResolvedValueOnce(null).mockResolvedValueOnce('v');

    expect(provider.capabilities).toEqual({
      read: true,
      write: true,
      delete: true,
    });
    await expect(
      registry.ensure({ provider: 'os-keyring', key: 'k' }, 'v'),
    ).resolves.toEqual({ changed: true });
    expect(keyring.write).toHaveBeenCalledWith('k', 'v');

    await registry.delete({ provider: 'os-keyring', key: 'k' });
    expect(keyring.delete).toHaveBeenCalledWith('k');

    keyring.probe.mockResolvedValueOnce('present');
    await expect(
      registry.probe({ provider: 'os-keyring', key: 'k' }),
    ).resolves.toBe('present');
    expect(keyring.constructor).toHaveBeenCalledOnce();
  });
  it.each(['positional', 'options'] as const)(
    'configures the file provider from the supplied %s environment',
    async (signature) => {
      const env: Record<string, string> = {
        MOLTNET_SECRET_ROOT: '/nonexistent/root',
        MOLTNET_SECRET_ROOT_WRITABLE: '1',
      };
      const registry =
        signature === 'positional'
          ? createNodeSecretProviderRegistry('linux', (name) => env[name])
          : createNodeSecretProviderRegistry({
              platform: 'linux',
              readEnv: (name) => env[name],
            });

      expect(registry.get('file')?.capabilities.write).toBe(true);
      await expect(
        registry.probe({ provider: 'file', key: 'k' }),
      ).resolves.toBe('inaccessible');
    },
  );
});
