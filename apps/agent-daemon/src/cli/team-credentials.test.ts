import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type MoltNetConfig,
  READ_ONLY_CAPABILITIES,
  SecretProviderRegistry,
  type Whoami,
} from '@themoltnet/sdk';
import type * as SdkNode from '@themoltnet/sdk/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runOnce } from './once.js';
import { runPoll } from './poll.js';
import { runSyncSessions } from './sync-sessions.js';

const { connectMock, registryMock, signingMock, syncMock, boundary } =
  vi.hoisted(() => ({
    connectMock: vi.fn(),
    registryMock: vi.fn(),
    signingMock: vi.fn(),
    syncMock: vi.fn(),
    boundary: new Error('authenticated command boundary reached'),
  }));

// Keep the config reader, selector, secret resolver and startup binding check real.
// Stop after authentication, before signing or mutating runtime sessions.
vi.mock('@themoltnet/sdk/node', async (importOriginal) => ({
  ...(await importOriginal<typeof SdkNode>()),
  connect: connectMock,
  createNodeSecretProviderRegistry: registryMock,
}));
vi.mock('../config.js', () => ({
  processEnvSnapshot: () => ({}),
  loadConfig: () => ({
    credentialSource: 'config',
    credentialEnforcement: 'off',
    profileCredentialRequirements: '',
    credentialBindings: '',
  }),
}));
vi.mock('../lib/executor-attestation.js', () => ({
  resolveExecutorSigningPrivateKey: signingMock,
}));
vi.mock('../lib/runtime-session-sync.js', () => ({
  syncRuntimeSessions: syncMock,
}));
vi.mock('../lib/logger.js', () => ({ logDaemonStartupFailure: vi.fn() }));
vi.mock('../pi.js', () => ({ defaultPiDaemonAdapter: {} }));

let root: string;
let values: Record<string, string>;
let binding: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  root = mkdtempSync(join(tmpdir(), 'daemon-command-team-'));
  const directory = join(root, '.moltnet', 'test-agent');
  mkdirSync(directory, { recursive: true });
  const config: MoltNetConfig = {
    subject_id: 'agent-1',
    subject_type: 'agent',
    registered_at: 't',
    agent_key_ref: { provider: 'memory', key: 'agent-key/agent-1' },
    agent_key_refs: {
      a: { provider: 'memory', key: 'agent-key/agent-1/a' },
      b: { provider: 'memory', key: 'agent-key/agent-1/b' },
    },
    keys: {
      public_key: 'ed25519:public',
      fingerprint: 'FP-1',
      private_key_ref: { provider: 'memory', key: 'identity/FP-1/seed' },
    },
    endpoints: {
      api: 'https://api.themolt.net',
      mcp: 'https://mcp.themolt.net',
    },
  };
  writeFileSync(join(directory, 'moltnet.json'), JSON.stringify(config));
  values = {
    'agent-key/agent-1': 'fallback',
    'agent-key/agent-1/a': 'secret-a',
    'agent-key/agent-1/b': 'secret-b',
  };
  registryMock.mockReturnValue(
    new SecretProviderRegistry().register({
      name: 'memory',
      capabilities: READ_ONLY_CAPABILITIES,
      read: (key) => Promise.resolve(values[key] ?? null),
      probe: (key) => Promise.resolve(key in values ? 'present' : 'absent'),
    }),
  );
  binding = 'selected';
  connectMock.mockImplementation((options: SdkNode.ConnectOptions) => ({
    agents: {
      whoami: async (): Promise<Whoami> => ({
        subjectId: 'agent-1',
        identityId: 'identity-1',
        subjectType: 'agent',
        ...(binding
          ? {
              credentialBinding: {
                bindingScope: 'team',
                keyId: 'key-1',
                boundTeamId:
                  binding === 'selected'
                    ? (options.agentKey?.slice(-1) ?? 'unbound')
                    : binding,
              },
            }
          : {}),
      }),
    },
  }));
  signingMock.mockRejectedValue(boundary);
  syncMock.mockRejectedValue(boundary);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe.each([
  {
    name: 'once',
    run: runOnce,
    extra: ['--task-id', 'task-1', '--profile', 'profile'],
  },
  {
    name: 'poll',
    run: runPoll,
    extra: ['--profile', 'profile', '--task-types', 'freeform'],
  },
  { name: 'sync-sessions', run: runSyncSessions, extra: [] },
])('$name project credential selection', ({ run, extra }) => {
  function invoke(team?: string) {
    const configPath = join(root, 'projects.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        version: 1,
        bindings: [
          {
            name: 'checkout',
            apiUrl: 'https://api.themolt.net',
            teamId: 'b',
            projectId: 'project-1',
            source: root,
            strategy: 'existing',
          },
        ],
      }),
    );
    return run([
      '--agent',
      'test-agent',
      '--agent-root',
      root,
      '--config-file',
      configPath,
      '--binding',
      'checkout',
      ...(team ? ['--team', team] : []),
      ...extra,
    ]);
  }

  it('selects the binding team credential without an explicit team flag', async () => {
    await expect(invoke()).rejects.toBe(boundary);
    expect(connectMock).toHaveBeenCalledWith(
      expect.objectContaining({ agentKey: 'secret-b' }),
    );
  });

  it('rejects a conflicting team before resolving credentials', async () => {
    await expect(invoke('a')).resolves.toBe(1);
    expect(connectMock).not.toHaveBeenCalled();
    expect(signingMock).not.toHaveBeenCalled();
  });
});

describe.each([
  {
    name: 'once',
    run: runOnce,
    extra: ['--task-id', 'task-1', '--profile', 'profile'],
  },
  {
    name: 'poll',
    run: runPoll,
    extra: ['--profile', 'profile', '--task-types', 'freeform'],
  },
  { name: 'sync-sessions', run: runSyncSessions, extra: [] },
])('$name team credential boundary', ({ run, extra }) => {
  const invoke = (team = 'b') =>
    run([
      '--agent',
      'test-agent',
      '--agent-root',
      root,
      '--team',
      team,
      ...extra,
    ]);

  it.each(['a', 'b'])(
    'selects team %s through the command entrypoint',
    async (team) => {
      await expect(invoke(team)).rejects.toBe(boundary);
      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(connectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          agentKey: `secret-${team}`,
        }),
      );
    },
  );

  it.each([undefined, 'a'])(
    'rejects missing or mismatched binding %s before work',
    async (reportedBinding) => {
      binding = reportedBinding;
      await expect(invoke()).rejects.toThrow(
        'selected team credential has a different binding',
      );
      expect(signingMock).not.toHaveBeenCalled();
      expect(syncMock).not.toHaveBeenCalled();
    },
  );

  it('does not fall back when the selected secret is absent', async () => {
    delete values['agent-key/agent-1/b'];
    await expect(invoke()).rejects.toThrow('could not resolve');
    expect(connectMock).not.toHaveBeenCalled();
    expect(signingMock).not.toHaveBeenCalled();
    expect(syncMock).not.toHaveBeenCalled();
  });
});
