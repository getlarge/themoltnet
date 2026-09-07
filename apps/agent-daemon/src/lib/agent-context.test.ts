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
  resolveAgentKeyMock,
  assertTrustedConfigApiUrlMock,
  requireSecureCredentialApiUrlMock,
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
    resolveAgentKeyMock: vi.fn(),
    assertTrustedConfigApiUrlMock: vi.fn(),
    requireSecureCredentialApiUrlMock: vi.fn(),
    AuthenticationErrorMock,
  };
});

vi.mock('@themoltnet/sdk', () => ({
  readConfig: readConfigMock,
  getIdentityDir: getIdentityDirMock,
  resolveAgentKey: resolveAgentKeyMock,
  assertTrustedConfigApiUrl: assertTrustedConfigApiUrlMock,
  requireSecureCredentialApiUrl: requireSecureCredentialApiUrlMock,
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
  detectCredentialSource,
  resolveAgentContext,
  validateStartupBinding,
} from './agent-context.js';

describe('resolveAgentContext', () => {
  beforeEach(() => {
    connectMock.mockReset();
    readConfigMock.mockReset();
    readConfigMock.mockResolvedValue(null);
    resolveAgentKeyMock.mockReset();
    resolveAgentKeyMock.mockResolvedValue('ak_live_resolved');
    assertTrustedConfigApiUrlMock.mockReset();
    requireSecureCredentialApiUrlMock.mockReset();
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
      // resolveAgentContext now requires a key reference in the config;
      // the central store supplies the directory, this supplies the key.
      readConfigMock.mockResolvedValue({
        agent_key_ref: { provider: 'file', key: 'agent-key.id' },
      });

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

  // `--agent-root` is a documented flag ("Directory that owns .moltnet/<agent>")
  // still accepted by once, poll and sync-sessions. The central-store cutover
  // stopped honouring it while keeping the flag, so every caller that passed
  // one — sandboxed runs, the e2e harness — was silently sent to a central
  // store it had never populated and failed with "No credentials found".
  it('honours an explicit --agent-root that owns a bundle', async () => {
    const agentRoot = mkdtempSync(join(tmpdir(), 'daemon-explicit-root-'));
    const bundle = join(agentRoot, '.moltnet', 'legreffier');
    mkdirSync(bundle, { recursive: true });
    writeFileSync(join(bundle, 'moltnet.json'), JSON.stringify({ oauth2: {} }));

    try {
      readConfigMock.mockResolvedValue({
        agent_key_ref: { provider: 'file', key: 'agent-key.id' },
      });
      const ctx = await resolveAgentContext('legreffier', {
        agentRootDir: agentRoot,
      });

      expect(ctx.agentDir).toBe(bundle);
      // The OWNING root is what gets mounted into the sandbox, not the
      // credentials directory itself.
      expect(ctx.agentRootDir).toBe(agentRoot);
      expect(connectMock).toHaveBeenCalledWith(
        expect.objectContaining({ configDir: bundle }),
      );
    } finally {
      rmSync(agentRoot, { recursive: true, force: true });
    }
  });

  // Explicit override, not rediscovery: without the flag nothing is searched.
  it('ignores a bundle when no --agent-root was passed', async () => {
    const cwdBundle = mkdtempSync(join(tmpdir(), 'daemon-implicit-root-'));
    mkdirSync(join(cwdBundle, '.moltnet', 'legreffier'), { recursive: true });
    writeFileSync(
      join(cwdBundle, '.moltnet', 'legreffier', 'moltnet.json'),
      JSON.stringify({ oauth2: {} }),
    );

    try {
      readConfigMock.mockResolvedValue({
        agent_key_ref: { provider: 'file', key: 'agent-key.id' },
      });
      const ctx = await resolveAgentContext('legreffier');
      expect(ctx.agentDir).toBe('/central/identities/legreffier');
    } finally {
      rmSync(cwdBundle, { recursive: true, force: true });
    }
  });

  it('does not fall back to the Git root', async () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'daemon-sandbox-root-'));
    const gitRoot = mkdtempSync(join(tmpdir(), 'daemon-git-root-'));
    execFileSyncMock.mockReturnValue(`${gitRoot}\n`);

    try {
      // resolveAgentContext now requires a key reference in the config;
      // the central store supplies the directory, this supplies the key.
      readConfigMock.mockResolvedValue({
        agent_key_ref: { provider: 'file', key: 'agent-key.id' },
      });

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

  it('connects without a config dir when the key is configless', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-agent-key-root-'));
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not a git repo');
    });

    try {
      const ctx = await resolveAgentContext('legreffier', {
        agentRootDir: root,
        credentialSource: 'environment',
      });

      // agent-key is configless — it never reads moltnet.json — so an
      // explicit --agent-root is honoured without requiring that file to
      // exist. Asserting the central dir here blessed the regression that
      // sent configless runs to a store they had never populated, which is
      // what agent-key.e2e.test.ts catches end to end.
      expect(ctx.agentDir).toBe(join(root, '.moltnet', 'legreffier'));
      expect(ctx.agentRootDir).toBe(root);
      expect(ctx.credentialSource).toBe('environment');
      // No configDir: the key (or its reference) comes from the environment;
      // the Node registry is supplied so keyring/file references resolve.
      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(connectMock.mock.calls[0][0]).not.toHaveProperty('configDir');
      expect(createNodeSecretProviderRegistryMock).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not implicitly expose a complete local guest config when configless', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-agent-key-configured-'));
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not a git repo');
    });

    try {
      writeCredentials(root, 'legreffier');
      await resolveAgentContext('legreffier', {
        agentRootDir: root,
        credentialSource: 'environment',
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

      readConfigMock.mockResolvedValueOnce({
        agent_key_ref: { provider: 'file', key: 'agent-key.id' },
      });
      const ctx = await resolveAgentContext('legreffier', {
        agentRootDir: root,
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

describe('detectCredentialSource', () => {
  it('reports the environment when MOLTNET_AGENT_KEY holds a value', () => {
    expect(
      detectCredentialSource({ MOLTNET_AGENT_KEY: 'ak_live_secret' }),
    ).toBe('environment');
  });

  it('treats a blank / whitespace-only key as not set', () => {
    expect(detectCredentialSource({ MOLTNET_AGENT_KEY: '   ' })).toBe('config');
    expect(detectCredentialSource({ MOLTNET_AGENT_KEY: '' })).toBe('config');
  });

  it('reports the environment for MOLTNET_AGENT_KEY_REF', () => {
    expect(
      detectCredentialSource({ MOLTNET_AGENT_KEY_REF: 'file:agent-key.id' }),
    ).toBe('environment');
    expect(detectCredentialSource({ MOLTNET_AGENT_KEY_REF: ' ' })).toBe(
      'config',
    );
  });

  it('falls back to the config file when no environment key is set', () => {
    expect(detectCredentialSource({})).toBe('config');
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

describe('config API URL trust', () => {
  // Passing an explicit agentKey skips ambient's own URL normalisation, so the
  // two checks the config path used to run have to be reapplied. Mocking them
  // without asserting them would let a future edit drop both silently.
  const configWithKey = {
    agent_key_ref: { provider: 'file', key: 'agent-key.id-1' },
    endpoints: { api: 'https://api.themolt.net' },
  };

  it('vets a URL taken from moltnet.json before trusting it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-url-config-'));
    try {
      writeCredentials(root, 'legreffier');
      readConfigMock.mockResolvedValue(configWithKey);
      resolveAgentKeyMock.mockResolvedValue('ak_live');
      assertTrustedConfigApiUrlMock.mockClear();
      requireSecureCredentialApiUrlMock.mockClear();

      await resolveAgentContext('legreffier', { agentRootDir: root });

      expect(assertTrustedConfigApiUrlMock).toHaveBeenCalledWith(
        'https://api.themolt.net',
      );
      expect(requireSecureCredentialApiUrlMock).toHaveBeenCalledWith(
        'https://api.themolt.net',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('propagates a rejection instead of connecting to an untrusted URL', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-url-untrusted-'));
    try {
      writeCredentials(root, 'legreffier');
      readConfigMock.mockResolvedValue({
        ...configWithKey,
        endpoints: { api: 'https://evil.example.test' },
      });
      resolveAgentKeyMock.mockResolvedValue('ak_live');
      assertTrustedConfigApiUrlMock.mockImplementation(() => {
        throw new Error('untrusted API URL');
      });
      connectMock.mockClear();

      await expect(
        resolveAgentContext('legreffier', { agentRootDir: root }),
      ).rejects.toThrow(/untrusted API URL/u);
      expect(connectMock).not.toHaveBeenCalled();
    } finally {
      assertTrustedConfigApiUrlMock.mockReset();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('defers to the environment URL without vetting the config one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-url-env-'));
    try {
      writeCredentials(root, 'legreffier');
      readConfigMock.mockResolvedValue(configWithKey);
      resolveAgentKeyMock.mockResolvedValue('ak_live');
      assertTrustedConfigApiUrlMock.mockClear();
      connectMock.mockClear();

      await resolveAgentContext('legreffier', {
        agentRootDir: root,
        envApiUrl: 'https://api.staging.example',
      });

      // connect() reads MOLTNET_API_URL itself; the config URL is unused, so
      // vetting it would reject a run that never depends on it.
      expect(assertTrustedConfigApiUrlMock).not.toHaveBeenCalled();
      expect(
        (connectMock.mock.calls[0][0] as { apiUrl?: string }).apiUrl,
      ).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('agent-key requirement', () => {
  it('uses the configured agent key even when OAuth2 env credentials are set', async () => {
    // `moltnet start` injects MOLTNET_CLIENT_ID / MOLTNET_CLIENT_SECRET
    // (start.go). Ambient resolution ranks environment OAuth2 *above* a
    // configured agent_key_ref, so merely checking that the ref exists and then
    // calling ambient connect() would still authenticate with the over-scoped
    // OAuth2 token. Resolving the key and passing it explicitly is what makes
    // the key win, and this test is the thing that proves it.
    const root = mkdtempSync(join(tmpdir(), 'daemon-oauth-env-root-'));
    vi.stubEnv('MOLTNET_CLIENT_ID', 'oauth-client-id');
    vi.stubEnv('MOLTNET_CLIENT_SECRET', 'oauth-client-secret');
    try {
      writeCredentials(root, 'legreffier');
      readConfigMock.mockResolvedValue({
        agent_key_ref: { provider: 'file', key: 'agent-key.id-1' },
        oauth2: { client_id: 'oauth-client-id' },
      });
      resolveAgentKeyMock.mockResolvedValue('ak_live_from_config');
      connectMock.mockClear();

      const ctx = await resolveAgentContext('legreffier', {
        agentRootDir: root,
      });

      expect(ctx.credentialSource).toBe('config');
      const passed = connectMock.mock.calls[0][0] as {
        agentKey?: string;
        clientId?: string;
        clientSecret?: string;
      };
      expect(passed.agentKey).toBe('ak_live_from_config');
      expect(passed.clientId).toBeUndefined();
      expect(passed.clientSecret).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses when agent_key_ref is present but resolves to nothing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-empty-key-root-'));
    try {
      writeCredentials(root, 'legreffier');
      readConfigMock.mockResolvedValue({
        agent_key_ref: { provider: 'file', key: 'agent-key.id-1' },
      });
      resolveAgentKeyMock.mockResolvedValue(null);
      connectMock.mockClear();

      await expect(
        resolveAgentContext('legreffier', { agentRootDir: root }),
      ).rejects.toThrow(/agent_key_ref/u);
      expect(connectMock).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses an OAuth2-only config and points at the CLI that mints a key', async () => {
    // Arrange: the pre-#2160 shape — a moltnet.json with client credentials
    // and no agent_key_ref. connect() would authenticate it happily, which is
    // exactly why the daemon has to refuse it here.
    const root = mkdtempSync(join(tmpdir(), 'daemon-oauth2-root-'));
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not a git repo');
    });
    try {
      writeCredentials(root, 'legreffier');
      readConfigMock.mockResolvedValue({
        client_id: 'agent-client',
        client_secret: 'plaintext-secret',
      });
      connectMock.mockClear();

      // Act / Assert
      await expect(
        resolveAgentContext('legreffier', { agentRootDir: root }),
      ).rejects.toThrow(/agent_key_ref/u);
      await expect(
        resolveAgentContext('legreffier', { agentRootDir: root }),
      ).rejects.toThrow(/moltnet agents keys create/u);
      // Never authenticated: the refusal precedes connect().
      expect(connectMock).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('gives a runnable recipe and a link, not just a diagnosis', async () => {
    // Arrange: this message is the entire recovery path for an operator whose
    // daemon will not start, so it has to carry the commands that produce the
    // two ids as well as the one that mints the key.
    const root = mkdtempSync(join(tmpdir(), 'daemon-recipe-root-'));
    try {
      writeCredentials(root, 'legreffier');
      readConfigMock.mockResolvedValue({ client_id: 'agent-client' });

      // Act
      const error = await resolveAgentContext('legreffier', {
        agentRootDir: root,
      }).catch((err: unknown) => err as Error);

      // Assert
      const text = (error as Error).message;
      expect(text).toContain('moltnet agents whoami');
      expect(text).toContain('moltnet teams list');
      expect(text).toContain('moltnet agents keys create');
      expect(text).toContain('--store');
      expect(text).toContain('MOLTNET_AGENT_KEY');
      expect(text).toContain(
        'https://docs.themolt.net/operate/agent-keys',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('names the scopes a daemon key needs, including crypto:sign', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-scopes-root-'));
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not a git repo');
    });
    try {
      writeCredentials(root, 'legreffier');
      readConfigMock.mockResolvedValue({ client_id: 'agent-client' });

      await expect(
        resolveAgentContext('legreffier', { agentRootDir: root }),
      ).rejects.toThrow(/crypto:sign/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts a config carrying agent_key_ref, and an environment key', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-source-root-'));
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not a git repo');
    });
    try {
      writeCredentials(root, 'legreffier');
      readConfigMock.mockResolvedValue({
        agent_key_ref: { provider: 'file', key: 'agent-key.id-1' },
      });
      // This describe has no beforeEach, so state a resolvable key explicitly.
      resolveAgentKeyMock.mockResolvedValue('ak_live_resolved');

      const keyed = await resolveAgentContext('legreffier', {
        agentRootDir: root,
      });
      expect(keyed.credentialSource).toBe('config');

      const env = await resolveAgentContext('legreffier', {
        agentRootDir: root,
        credentialSource: 'environment',
      });
      expect(env.credentialSource).toBe('environment');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
