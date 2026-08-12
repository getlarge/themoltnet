import { cryptoService } from '@moltnet/crypto-service';
import type { Whoami } from '@themoltnet/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createExecutorAttestorMock, readConfigMock } = vi.hoisted(() => ({
  createExecutorAttestorMock: vi.fn(),
  readConfigMock: vi.fn(),
}));

vi.mock('@themoltnet/sdk', () => ({
  createExecutorAttestor: createExecutorAttestorMock,
  readConfig: readConfigMock,
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

  it('preserves OAuth2 config-backed private-key resolution', async () => {
    readConfigMock.mockResolvedValue({
      keys: { private_key: 'oauth-seed' },
    });
    await expect(
      resolveExecutorSigningPrivateKey({
        authMode: 'oauth2',
        agentDir: '/repo/.moltnet/agent',
        configuredPrivateKey: 'ignored-env-seed',
      }),
    ).resolves.toBe('oauth-seed');
    expect(readConfigMock).toHaveBeenCalledWith('/repo/.moltnet/agent');
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
});
