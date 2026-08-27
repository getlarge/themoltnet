import { cryptoService } from '@moltnet/crypto-service';
import type { Whoami } from '@themoltnet/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createExecutorAttestorMock,
  readConfigMock,
  resolveIdentitySeedMock,
  registryMock,
} = vi.hoisted(() => ({
  createExecutorAttestorMock: vi.fn(),
  readConfigMock: vi.fn(),
  resolveIdentitySeedMock: vi.fn(),
  registryMock: { name: 'node-registry' },
}));

vi.mock('@themoltnet/sdk', () => ({
  createExecutorAttestor: createExecutorAttestorMock,
  readConfig: readConfigMock,
  resolveIdentitySeed: resolveIdentitySeedMock,
}));
vi.mock('@themoltnet/sdk/node', () => ({
  createNodeSecretProviderRegistry: () => registryMock,
}));

import {
  attestPreparedRuntime,
  DAEMON_REQUIRED_SCOPES,
  resolveExecutorSigningPrivateKey,
  validateDaemonScopes,
  validateExecutorSigningIdentity,
} from './executor-attestation.js';

function agentWhoami(overrides: Partial<Whoami> = {}): Whoami {
  return {
    identityId: 'identity-1',
    scopes: [...DAEMON_REQUIRED_SCOPES],
    subjectType: 'agent',
    ...overrides,
  };
}

describe('resolveExecutorSigningPrivateKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses MOLTNET_PRIVATE_KEY directly in agent-key mode', async () => {
    await expect(
      resolveExecutorSigningPrivateKey({
        authMode: 'agent-key',
        agentDir: '/missing/.moltnet/agent',
        configuredPrivateKey: ' direct-seed ',
      }),
    ).resolves.toBe('direct-seed');
    expect(readConfigMock).not.toHaveBeenCalled();
  });

  it('fails agent-key mode without consulting config or a provider', async () => {
    await expect(
      resolveExecutorSigningPrivateKey({
        authMode: 'agent-key',
        agentDir: '/missing/.moltnet/agent',
        configuredPrivateKey: '',
      }),
    ).rejects.toThrow('MOLTNET_PRIVATE_KEY');
    expect(readConfigMock).not.toHaveBeenCalled();
  });

  it('resolves the OAuth2 config seed through the Node secret-provider registry', async () => {
    const config = {
      keys: {
        public_key: 'pk',
        fingerprint: 'fp',
        private_key_ref: { provider: 'file', key: 'identity/fp/seed' },
      },
    };
    readConfigMock.mockResolvedValue(config);
    resolveIdentitySeedMock.mockResolvedValue('oauth-seed');

    await expect(
      resolveExecutorSigningPrivateKey({
        authMode: 'oauth2',
        agentDir: '/repo/.moltnet/agent',
        configuredPrivateKey: 'ignored-env-seed',
      }),
    ).resolves.toBe('oauth-seed');
    expect(readConfigMock).toHaveBeenCalledWith('/repo/.moltnet/agent');
    expect(resolveIdentitySeedMock).toHaveBeenCalledWith(config, registryMock);
  });

  it('fails OAuth2 mode without a config and wraps resolver failures without the value', async () => {
    readConfigMock.mockResolvedValueOnce(null);
    await expect(
      resolveExecutorSigningPrivateKey({
        authMode: 'oauth2',
        agentDir: '/repo/.moltnet/agent',
        configuredPrivateKey: '',
      }),
    ).rejects.toThrow('/repo/.moltnet/agent/moltnet.json');

    readConfigMock.mockResolvedValueOnce({ keys: { public_key: 'pk' } });
    resolveIdentitySeedMock.mockRejectedValueOnce(
      new Error(
        'identity-seed: config must set exactly one of private_key or private_key_ref',
      ),
    );
    await expect(
      resolveExecutorSigningPrivateKey({
        authMode: 'oauth2',
        agentDir: '/repo/.moltnet/agent',
        configuredPrivateKey: '',
      }),
    ).rejects.toThrow(/keys\.private_key_ref.*exactly one/);
  });
});

describe('daemon credential validation', () => {
  it('reports every missing canonical daemon scope together', () => {
    expect(() =>
      validateDaemonScopes(
        agentWhoami({ scopes: ['agent:profile', 'task:execute'] }),
      ),
    ).toThrow('runtime:read task:read task:claim');
  });

  it('accepts the canonical scopes plus additional authority', () => {
    expect(() =>
      validateDaemonScopes(
        agentWhoami({ scopes: [...DAEMON_REQUIRED_SCOPES, 'diary:read'] }),
      ),
    ).not.toThrow();
  });

  it('requires the signing seed to match whoami public material', async () => {
    const signing = await cryptoService.generateKeyPair();
    const other = await cryptoService.generateKeyPair();

    await expect(
      validateExecutorSigningIdentity({
        whoami: agentWhoami({
          publicKey: signing.publicKey,
          fingerprint: signing.fingerprint,
        }),
        signingPrivateKey: signing.privateKey,
      }),
    ).resolves.toBeUndefined();
    await expect(
      validateExecutorSigningIdentity({
        whoami: agentWhoami({
          publicKey: other.publicKey,
          fingerprint: other.fingerprint,
        }),
        signingPrivateKey: signing.privateKey,
      }),
    ).rejects.toThrow('does not match the authenticated agent');
  });

  it('accepts an equivalent bare base64 authenticated public key', async () => {
    const signing = await cryptoService.generateKeyPair();

    await expect(
      validateExecutorSigningIdentity({
        whoami: agentWhoami({
          publicKey: signing.publicKey.replace(/^ed25519:/, ''),
          fingerprint: signing.fingerprint,
        }),
        signingPrivateKey: signing.privateKey,
      }),
    ).resolves.toBeUndefined();
  });

  it.each([
    { publicKey: undefined, fingerprint: 'fingerprint' },
    { publicKey: 'ed25519:not-a-key', fingerprint: 'fingerprint' },
    { publicKey: 'ed25519:Zm9v', fingerprint: undefined },
  ])('rejects absent or malformed whoami public material', async (material) => {
    const signing = await cryptoService.generateKeyPair();

    await expect(
      validateExecutorSigningIdentity({
        whoami: agentWhoami(material),
        signingPrivateKey: signing.privateKey,
      }),
    ).rejects.toThrow(/whoami response/);
  });

  it('rejects a whoami fingerprint inconsistent with its public key', async () => {
    const signing = await cryptoService.generateKeyPair();

    await expect(
      validateExecutorSigningIdentity({
        whoami: agentWhoami({
          publicKey: signing.publicKey,
          fingerprint: '0000-0000-0000-0000',
        }),
        signingPrivateKey: signing.privateKey,
      }),
    ).rejects.toThrow('does not match the authenticated agent');
  });
});

describe('attestPreparedRuntime', () => {
  it('adds daemon-owned attestation after the adapter returns inventory', async () => {
    const attestor = { fingerprint: 'executor-fingerprint' };
    createExecutorAttestorMock.mockReturnValue(attestor);
    const prepared = {
      runtimeKind: 'custom',
      manifest: { runtime: { id: 'custom' } },
      tools: ['tool'],
      executables: ['bin'],
      createTaskExecutor: vi.fn(),
    };

    expect(attestPreparedRuntime(prepared, 'signing-seed')).toEqual({
      ...prepared,
      attestor,
    });
    expect(createExecutorAttestorMock).toHaveBeenCalledWith({
      manifest: prepared.manifest,
      signingPrivateKey: 'signing-seed',
    });
  });

  it('preserves the prepared runtime prototype', () => {
    class CustomPreparedRuntime {
      runtimeKind = 'custom' as const;
      manifest = { runtime: { id: 'custom' } };
      tools = ['tool'];
      executables = ['bin'];
      createTaskExecutor = vi.fn();
      adapterMethod() {
        return 'preserved';
      }
    }
    createExecutorAttestorMock.mockReturnValue({
      fingerprint: 'executor-fingerprint',
    });
    const prepared = new CustomPreparedRuntime();

    const attested = attestPreparedRuntime(prepared, 'signing-seed');

    expect(attested).toBe(prepared);
    expect(attested).toBeInstanceOf(CustomPreparedRuntime);
    expect((attested as unknown as CustomPreparedRuntime).adapterMethod()).toBe(
      'preserved',
    );
  });
});
