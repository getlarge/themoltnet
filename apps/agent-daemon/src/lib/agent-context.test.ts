import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Whoami } from '@themoltnet/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { connectMock, execFileSyncMock, AuthenticationErrorMock } = vi.hoisted(
  () => {
    class AuthenticationErrorMock extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'AuthenticationError';
      }
    }
    return {
      connectMock: vi.fn(),
      execFileSyncMock: vi.fn(),
      AuthenticationErrorMock,
    };
  },
);

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
}));

vi.mock('@themoltnet/sdk', () => ({
  connect: connectMock,
  AuthenticationError: AuthenticationErrorMock,
}));

const createNodeSecretProviderRegistryMock = vi.hoisted(() => vi.fn());

vi.mock('@themoltnet/sdk/node', () => ({
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
    connectMock.mockResolvedValue({ agent: 'connected' });
    execFileSyncMock.mockReset();
    createNodeSecretProviderRegistryMock.mockReset();
    createNodeSecretProviderRegistryMock.mockReturnValue({
      provider: 'registry',
    });
  });

  it('uses an explicit repo-free root when credentials exist there', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-agent-root-'));
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not a git repo');
    });

    try {
      writeCredentials(root, 'legreffier');

      const ctx = await resolveAgentContext('legreffier', {
        agentRootDir: root,
      });

      const agentDir = join(root, '.moltnet', 'legreffier');
      expect(ctx.agentDir).toBe(agentDir);
      expect(ctx.agentRootDir).toBe(root);
      expect(ctx.guestCredentialMode).toBe('guest-config');
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

  it('falls back to the git root when the explicit root has no credentials', async () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'daemon-sandbox-root-'));
    const gitRoot = mkdtempSync(join(tmpdir(), 'daemon-git-root-'));
    execFileSyncMock.mockReturnValue(`${gitRoot}\n`);

    try {
      writeCredentials(gitRoot, 'legreffier');

      const ctx = await resolveAgentContext('legreffier', {
        agentRootDir: sandboxRoot,
      });

      const agentDir = join(gitRoot, '.moltnet', 'legreffier');
      expect(ctx.agentDir).toBe(agentDir);
      expect(ctx.agentRootDir).toBe(gitRoot);
      expect(ctx.guestCredentialMode).toBe('guest-config');
      expect(connectMock).toHaveBeenCalledWith(
        expect.objectContaining({ configDir: agentDir }),
      );
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
      rmSync(gitRoot, { recursive: true, force: true });
    }
  });

  it('connects without config or secret providers in agent-key mode', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-agent-key-root-'));
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not a git repo');
    });

    try {
      const ctx = await resolveAgentContext('legreffier', {
        agentRootDir: root,
        authMode: 'agent-key',
      });

      const agentDir = join(root, '.moltnet', 'legreffier');
      expect(ctx.agentDir).toBe(agentDir);
      expect(ctx.guestCredentialMode).toBe('host-authenticated');
      expect(connectMock).toHaveBeenCalledWith();
      expect(createNodeSecretProviderRegistryMock).not.toHaveBeenCalled();
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
      const ctx = await resolveAgentContext('legreffier', {
        agentRootDir: root,
        authMode: 'agent-key',
      });

      expect(ctx.guestCredentialMode).toBe('host-authenticated');
      expect(connectMock).toHaveBeenCalledWith();
      expect(createNodeSecretProviderRegistryMock).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses complete local guest config only after explicit opt-in', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-agent-key-opt-in-'));
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not a git repo');
    });

    try {
      writeCredentials(root, 'legreffier');
      const ctx = await resolveAgentContext('legreffier', {
        agentRootDir: root,
        authMode: 'agent-key',
        guestCredentialMode: 'guest-config',
      });

      expect(ctx.guestCredentialMode).toBe('guest-config');
      expect(connectMock).toHaveBeenCalledWith();
      expect(createNodeSecretProviderRegistryMock).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a partial local guest config after explicit opt-in', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-agent-key-partial-'));
    const agentDir = join(root, '.moltnet', 'legreffier');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'moltnet.json'), '{}', 'utf8');
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not a git repo');
    });

    try {
      await expect(
        resolveAgentContext('legreffier', {
          agentRootDir: root,
          authMode: 'agent-key',
          guestCredentialMode: 'guest-config',
        }),
      ).rejects.toThrow('moltnet.json and env must both exist');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects host-authenticated guest mode with OAuth2', async () => {
    await expect(
      resolveAgentContext('legreffier', {
        authMode: 'oauth2',
        guestCredentialMode: 'host-authenticated',
      }),
    ).rejects.toThrow('requires agent-key authentication');
    expect(connectMock).not.toHaveBeenCalled();
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
