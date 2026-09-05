import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Whoami } from '@themoltnet/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  connectMock,
  execFileSyncMock,
  getIdentityDirMock,
  readConfigMock,
  AuthenticationErrorMock,
} = vi.hoisted(() => {
  class AuthenticationErrorMock extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'AuthenticationError';
    }
  }
  return {
    connectMock: vi.fn(),
    execFileSyncMock: vi.fn(),
    getIdentityDirMock: vi.fn((name: string) =>
      join('/central/identities', name),
    ),
    readConfigMock: vi.fn(),
    AuthenticationErrorMock,
  };
});

vi.mock('@themoltnet/sdk', () => ({
  readConfig: readConfigMock,
  getIdentityDir: getIdentityDirMock,
  AuthenticationError: AuthenticationErrorMock,
  // Not mocked away: the alias grammar is shared with the Go CLI and the
  // daemon store, and mocking it would hide a divergence between them.
  assertIdentityAlias: (alias: string) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(alias)) {
      throw new Error(`invalid identity alias: ${alias}`);
    }
    return alias;
  },
}));

// Retained while fixtures exercise callers that still pass agentRootDir; the
// resolver no longer invokes Git for credential discovery.
vi.mock('node:child_process', () => ({ execFileSync: execFileSyncMock }));

const createNodeSecretProviderRegistryMock = vi.hoisted(() => vi.fn());

vi.mock('@themoltnet/sdk/node', () => ({
  connect: connectMock,
  createNodeSecretProviderRegistry: createNodeSecretProviderRegistryMock,
}));

import {
  assessStartupBinding,
  detectAuthMode,
  resolveAgentContext,
  validateStartupBinding,
} from './agent-context.js';

describe('resolveAgentContext', () => {
  beforeEach(() => {
    connectMock.mockReset();
    readConfigMock.mockReset();
    readConfigMock.mockResolvedValue(null);
    connectMock.mockResolvedValue({ agent: 'connected' });
    getIdentityDirMock.mockClear();
    execFileSyncMock.mockReset();
    createNodeSecretProviderRegistryMock.mockReset();
    createNodeSecretProviderRegistryMock.mockReturnValue({
      provider: 'registry',
    });
  });

  it('selects the central identity independently of an explicit repository root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-agent-root-'));
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not a git repo');
    });

    try {
      const ctx = await resolveAgentContext('legreffier', {
        agentRootDir: root,
      });

      const agentDir = '/central/identities/legreffier';
      expect(ctx.agentDir).toBe(agentDir);
      expect(ctx.agentRootDir).toBe(agentDir);
      expect(connectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          configDir: agentDir,
          secretProviders: { provider: 'registry' },
        }),
      );
      expect(createNodeSecretProviderRegistryMock).toHaveBeenCalledOnce();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not fall back to the Git root', async () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'daemon-sandbox-root-'));
    const gitRoot = mkdtempSync(join(tmpdir(), 'daemon-git-root-'));
    execFileSyncMock.mockReturnValue(`${gitRoot}\n`);

    try {
      const ctx = await resolveAgentContext('legreffier', {
        agentRootDir: sandboxRoot,
      });

      const agentDir = '/central/identities/legreffier';
      expect(ctx.agentDir).toBe(agentDir);
      expect(ctx.agentRootDir).toBe(agentDir);
      expect(connectMock).toHaveBeenCalledWith(
        expect.objectContaining({ configDir: agentDir }),
      );
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
      rmSync(gitRoot, { recursive: true, force: true });
    }
  });

  it('connects without a config dir in agent-key mode', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-agent-key-root-'));
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not a git repo');
    });

    try {
      const ctx = await resolveAgentContext('legreffier', {
        agentRootDir: root,
        authMode: 'agent-key',
      });

      const agentDir = '/central/identities/legreffier';
      expect(ctx.agentDir).toBe(agentDir);
      // No configDir: the key (or its reference) comes from the environment;
      // the Node registry is supplied so keyring/file references resolve.
      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(connectMock.mock.calls[0][0]).not.toHaveProperty('configDir');
      expect(createNodeSecretProviderRegistryMock).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not implicitly expose a complete local guest config in agent-key mode', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-agent-key-configured-'));
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not a git repo');
    });

    try {
      writeCredentials(root, 'legreffier');
      await resolveAgentContext('legreffier', {
        agentRootDir: root,
        authMode: 'agent-key',
      });

      // No configDir: the key (or its reference) comes from the environment;
      // the Node registry is supplied so keyring/file references resolve.
      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(connectMock.mock.calls[0][0]).not.toHaveProperty('configDir');
      expect(createNodeSecretProviderRegistryMock).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps the OAuth2 Agent host-resolved with an explicit host-authenticated guest', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-oauth2-host-auth-'));
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not a git repo');
    });

    try {
      const agentDir = '/central/identities/legreffier';

      const ctx = await resolveAgentContext('legreffier', {
        agentRootDir: root,
        authMode: 'oauth2',
      });

      expect(ctx.agentDir).toBe(agentDir);
      expect(connectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          configDir: agentDir,
          secretProviders: { provider: 'registry' },
        }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('detectAuthMode', () => {
  it('reports agent-key mode when MOLTNET_AGENT_KEY holds a value', () => {
    expect(detectAuthMode({ MOLTNET_AGENT_KEY: 'ak_live_secret' })).toBe(
      'agent-key',
    );
  });

  it('treats a blank / whitespace-only key as not set', () => {
    expect(detectAuthMode({ MOLTNET_AGENT_KEY: '   ' })).toBe('oauth2');
    expect(detectAuthMode({ MOLTNET_AGENT_KEY: '' })).toBe('oauth2');
  });

  it('reports agent-key mode for MOLTNET_AGENT_KEY_REF', () => {
    expect(detectAuthMode({ MOLTNET_AGENT_KEY_REF: 'file:agent-key.id' })).toBe(
      'agent-key',
    );
    expect(detectAuthMode({ MOLTNET_AGENT_KEY_REF: ' ' })).toBe('oauth2');
  });

  it('defaults to oauth2 when the key is absent', () => {
    expect(detectAuthMode({})).toBe('oauth2');
  });
});

describe('assessStartupBinding', () => {
  const TEAM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const TEAM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  function agentWhoami(overrides: Partial<Whoami> = {}): Whoami {
    return {
      identityId: 'id-1',
      scopes: ['agent:profile'],
      subjectType: 'agent',
      ...overrides,
    };
  }

  it('accepts an agent key bound to the daemon team', () => {
    const whoami = agentWhoami({
      credentialBinding: {
        bindingScope: 'team',
        keyId: 'key-1',
        boundTeamId: TEAM_A,
      },
    });
    expect(assessStartupBinding(whoami, TEAM_A)).toEqual({ ok: true });
  });

  it('rejects an agent key bound to a different team than --team', () => {
    const whoami = agentWhoami({
      credentialBinding: {
        bindingScope: 'team',
        keyId: 'key-1',
        boundTeamId: TEAM_B,
      },
    });
    const result = assessStartupBinding(whoami, TEAM_A);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain(TEAM_B);
      expect(result.reason).toContain(TEAM_A);
    }
  });

  it('accepts an identity-scoped agent key', () => {
    const whoami = agentWhoami({
      credentialBinding: { bindingScope: 'identity', keyId: 'key-1' },
    });
    expect(assessStartupBinding(whoami, TEAM_A)).toEqual({ ok: true });
  });

  it('accepts an OAuth2 agent identity (no credentialBinding)', () => {
    expect(assessStartupBinding(agentWhoami(), TEAM_A)).toEqual({ ok: true });
  });

  it('rejects a human subject', () => {
    const whoami = agentWhoami({ subjectType: 'human' });
    const result = assessStartupBinding(whoami, TEAM_A);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('human');
    }
  });
});

describe('validateStartupBinding', () => {
  const TEAM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const TEAM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  function stubAgent(whoami: () => Promise<Whoami>) {
    return { agents: { whoami } };
  }

  it('returns the whoami when the bound key matches the team', async () => {
    const whoami: Whoami = {
      identityId: 'id-1',
      scopes: ['agent:profile'],
      subjectType: 'agent',
      credentialBinding: {
        bindingScope: 'team',
        keyId: 'key-1',
        boundTeamId: TEAM_A,
      },
    };
    const result = await validateStartupBinding({
      agent: stubAgent(() => Promise.resolve(whoami)),
      teamId: TEAM_A,
    });
    expect(result).toEqual(whoami);
  });

  it('throws an actionable fatal when the key is rejected (401)', async () => {
    const agent = stubAgent(() =>
      Promise.reject(
        new AuthenticationErrorMock('agent key rejected (401): revoked'),
      ),
    );
    await expect(
      validateStartupBinding({ agent, teamId: TEAM_A }),
    ).rejects.toThrow(/rejected \(401\)/);
  });

  it('throws a fatal when the key is bound to another team', async () => {
    const whoami: Whoami = {
      identityId: 'id-1',
      scopes: ['agent:profile'],
      subjectType: 'agent',
      credentialBinding: {
        bindingScope: 'team',
        keyId: 'key-1',
        boundTeamId: TEAM_B,
      },
    };
    await expect(
      validateStartupBinding({
        agent: stubAgent(() => Promise.resolve(whoami)),
        teamId: TEAM_A,
      }),
    ).rejects.toThrow(TEAM_B);
  });

  const pinnedWhoami: Whoami = {
    identityId: 'id-1',
    publicKey: 'pk-1',
    fingerprint: 'fp-1',
    scopes: ['agent:profile'],
    subjectType: 'agent',
  };
  const expectedIdentity = {
    identityId: 'id-1',
    publicKey: 'pk-1',
    fingerprint: 'fp-1',
  };

  it('accepts a child identity matching its Agent Server activation', async () => {
    await expect(
      validateStartupBinding({
        agent: stubAgent(() => Promise.resolve(pinnedWhoami)),
        teamId: TEAM_A,
        expectedIdentity,
      }),
    ).resolves.toEqual(pinnedWhoami);
  });

  it.each([
    ['identity id', { identityId: 'id-2' }],
    ['public key', { publicKey: 'pk-2' }],
    ['fingerprint', { fingerprint: 'fp-2' }],
  ])(
    'rejects a child %s differing from its Agent Server activation',
    async (_, change) => {
      const whoami: Whoami = { ...pinnedWhoami, ...change };
      await expect(
        validateStartupBinding({
          agent: stubAgent(() => Promise.resolve(whoami)),
          teamId: TEAM_A,
          expectedIdentity,
        }),
      ).rejects.toThrow('does not match the Agent Server activation');
    },
  );

  it('propagates non-auth errors unchanged', async () => {
    const boom = new Error('network down');
    const agent = stubAgent(() => Promise.reject(boom));
    await expect(
      validateStartupBinding({ agent, teamId: TEAM_A }),
    ).rejects.toBe(boom);
  });

  it('retries transient whoami failures before startup validation', async () => {
    const whoami: Whoami = {
      identityId: 'id-1',
      scopes: ['agent:profile'],
      subjectType: 'agent',
    };
    const transient = Object.assign(new Error('upstream unavailable'), {
      statusCode: 503,
    });
    const source = vi
      .fn<() => Promise<Whoami>>()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce(whoami);

    await expect(
      validateStartupBinding({ agent: stubAgent(source), teamId: TEAM_A }),
    ).resolves.toEqual(whoami);
    expect(source).toHaveBeenCalledTimes(2);
  });
});

function writeCredentials(root: string, agentName: string): void {
  const agentDir = join(root, '.moltnet', agentName);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'moltnet.json'), '{}\n', 'utf8');
  writeFileSync(join(agentDir, 'env'), '', 'utf8');
}

describe('credential source vs auth mechanism', () => {
  it('reports oauth2 for a plain config, agent-key for a config with agent_key_ref, and environment source in key mode', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-mechanism-root-'));
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not a git repo');
    });
    try {
      writeCredentials(root, 'legreffier');

      const oauth = await resolveAgentContext('legreffier', {
        agentRootDir: root,
      });
      expect(oauth.credentialSource).toBe('config');
      expect(oauth.authMechanism).toBe('oauth2');

      readConfigMock.mockResolvedValueOnce({
        agent_key_ref: { provider: 'file', key: 'agent-key.id-1' },
      });
      const keyed = await resolveAgentContext('legreffier', {
        agentRootDir: root,
      });
      expect(keyed.credentialSource).toBe('config');
      expect(keyed.authMechanism).toBe('agent-key');

      const env = await resolveAgentContext('legreffier', {
        agentRootDir: root,
        authMode: 'agent-key',
      });
      expect(env.credentialSource).toBe('environment');
      expect(env.authMechanism).toBe('agent-key');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
