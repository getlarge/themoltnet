import type {
  ExtensionAPI,
  ToolCallEvent,
} from '@earendil-works/pi-coding-agent';
import type {
  CommandAnalysis,
  ShellCommandAnalyzer,
} from '@themoltnet/shell-command-analyzer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type AllowedToolsClient,
  createToolPolicyExtension,
  resolveSessionToolPolicy,
  type SessionToolPolicy,
} from './session-policy.js';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
const EXECUTION_POLICY_HASH = `sha256:${'b'.repeat(64)}`;
const CLAIM_POLICY_HASH = `sha256:${'a'.repeat(64)}`;
const decisionContext = {
  taskId: 'task-1',
  attemptN: 2,
  teamId: 'team-1',
  claimantAgentId: 'agent-1',
  leaseId: 'lease-1',
  proposerKind: 'human' as const,
  proposerId: 'human-1',
  claimRuntimeProfileId: 'claim-R',
  executionRuntimeProfileId: 'execution-R',
  claimRuntimeProfileRevision: 6,
  claimPolicySnapshotHash: CLAIM_POLICY_HASH,
  claimedExecutorFingerprint: 'bafkreiexecutor',
};

function agentReturning(
  enforcement: 'off' | 'watch' | 'enforce',
  allowedTools: string[],
  allowedShellCommands: Array<{ argvPrefix: string[] }> = [],
): AllowedToolsClient {
  return {
    runtimeProfiles: {
      allowedTools: vi.fn().mockResolvedValue({
        enforcement,
        allowedTools,
        allowedShellCommands,
        runtimeKind: 'gondolin_pi',
        policySnapshotHash: EXECUTION_POLICY_HASH,
        runtimeProfileRevision: 7,
      }),
    },
  };
}

function agentFailing(): AllowedToolsClient {
  return {
    runtimeProfiles: {
      allowedTools: vi.fn().mockRejectedValue(new Error('network down')),
    },
  };
}

/** Agent whose fetch never settles — exercises the resolver's deadline. */
function agentHanging(): AllowedToolsClient {
  return {
    runtimeProfiles: {
      allowedTools: vi.fn().mockReturnValue(new Promise<never>(() => {})),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('resolveSessionToolPolicy', () => {
  const params = {
    profileId: 'R',
    teamId: 'T',
    runtimeKind: 'gondolin_pi',
    logger,
  };

  it('refreshes policy when the cached enforcement mode is off', async () => {
    const agent = agentReturning('enforce', ['git']);
    const policy = await resolveSessionToolPolicy({
      ...params,
      agent,
      enforcement: 'off',
    });
    expect(policy).toEqual({
      enforcement: 'enforce',
      allowedTools: new Set(['git']),
      allowedShellCommands: [],
      executionPolicySnapshotHash: EXECUTION_POLICY_HASH,
      executionRuntimeProfileRevision: 7,
      degraded: false,
    });
    expect(agent.runtimeProfiles.allowedTools).toHaveBeenCalledOnce();
  });

  it('resolves the allow-set from the API for enforce (not degraded)', async () => {
    const policy = await resolveSessionToolPolicy({
      ...params,
      agent: agentReturning(
        'enforce',
        ['git', 'gh'],
        [{ argvPrefix: ['git', 'diff'] }],
      ),
      enforcement: 'enforce',
    });
    expect(policy.enforcement).toBe('enforce');
    expect(policy.degraded).toBe(false);
    expect([...policy.allowedTools].sort()).toEqual(['gh', 'git']);
    expect(policy.allowedShellCommands).toEqual([
      { argvPrefix: ['git', 'diff'] },
    ]);
    expect(policy.executionPolicySnapshotHash).toBe(EXECUTION_POLICY_HASH);
    expect(policy.executionRuntimeProfileRevision).toBe(7);
  });

  it('accepts legacy allowed-tools responses without provenance fields', async () => {
    const agent = agentReturning('enforce', ['git']);
    vi.mocked(agent.runtimeProfiles.allowedTools).mockResolvedValue({
      enforcement: 'enforce',
      allowedTools: ['git'],
      allowedShellCommands: [],
      runtimeKind: 'gondolin_pi',
    });

    const policy = await resolveSessionToolPolicy({
      ...params,
      agent,
      enforcement: 'enforce',
    });

    expect(policy.executionPolicySnapshotHash).toBeUndefined();
    expect(policy.executionRuntimeProfileRevision).toBeUndefined();
  });

  it('uses a degraded off fallback when refreshing cached off fails', async () => {
    const policy = await resolveSessionToolPolicy({
      ...params,
      agent: agentFailing(),
      enforcement: 'off',
    });

    expect(policy).toEqual({
      enforcement: 'off',
      allowedTools: new Set(),
      allowedShellCommands: [],
      degraded: true,
    });
  });

  it('fails closed and marks degraded when the fetch fails in enforce', async () => {
    const policy = await resolveSessionToolPolicy({
      ...params,
      agent: agentFailing(),
      enforcement: 'enforce',
    });
    expect(policy).toEqual({
      enforcement: 'enforce',
      allowedTools: new Set(),
      allowedShellCommands: [],
      degraded: true,
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('fails closed when the daemon runtime kind differs from the resolved policy', async () => {
    const agent = agentReturning('enforce', ['git']);
    vi.mocked(agent.runtimeProfiles.allowedTools).mockResolvedValue({
      enforcement: 'enforce',
      allowedTools: ['git'],
      allowedShellCommands: [],
      runtimeKind: 'custom_pi',
      policySnapshotHash: EXECUTION_POLICY_HASH,
      runtimeProfileRevision: 7,
    });

    const policy = await resolveSessionToolPolicy({
      ...params,
      agent,
      enforcement: 'enforce',
    });

    expect(policy).toEqual({
      enforcement: 'enforce',
      allowedTools: new Set(),
      allowedShellCommands: [],
      degraded: true,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({
          name: 'RuntimeKindMismatchError',
        }),
        failClosed: true,
      }),
      'tool_policy.resolve_failed',
    );
  });

  it('fails open-ish (audits) and marks degraded when the fetch fails in watch', async () => {
    const policy = await resolveSessionToolPolicy({
      ...params,
      agent: agentFailing(),
      enforcement: 'watch',
    });
    expect(policy).toEqual({
      enforcement: 'watch',
      allowedTools: new Set(),
      allowedShellCommands: [],
      degraded: true,
    });
  });

  it('times out a hung fetch and falls back to the degraded enforce policy', async () => {
    const policy = await resolveSessionToolPolicy({
      ...params,
      agent: agentHanging(),
      enforcement: 'enforce',
      timeoutMs: 5,
    });
    expect(policy).toEqual({
      enforcement: 'enforce',
      allowedTools: new Set(),
      allowedShellCommands: [],
      degraded: true,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ timedOut: true, failClosed: true }),
      'tool_policy.resolve_failed',
    );
  });
});

/** Analyzer stub resolving one command to a fixed executable list (or failing). */
function analyzerStub(
  map: Record<string, string[] | { reason: string }>,
): ShellCommandAnalyzer {
  const analyze = (command: string): CommandAnalysis => {
    const entry = map[command];
    if (entry && Array.isArray(entry)) {
      return {
        ok: true,
        command,
        ast: '',
        tools: entry.map((name) => ({
          name,
          argv: [name],
          risk: 'unknown',
          capabilities: [],
          raw: name,
        })),
      };
    }
    return {
      ok: false,
      command,
      reason: entry && 'reason' in entry ? entry.reason : 'unresolvable',
      ast: null,
    };
  };
  return { analyze } as unknown as ShellCommandAnalyzer;
}

function toolCall(
  toolName: string,
  input: Record<string, unknown>,
): ToolCallEvent {
  return {
    type: 'tool_call',
    toolCallId: 'call-1',
    toolName,
    input,
  } as ToolCallEvent;
}

function registerHandler(
  deps: Omit<Parameters<typeof createToolPolicyExtension>[0], 'context'> & {
    context?: Parameters<typeof createToolPolicyExtension>[0]['context'];
  },
) {
  const on = vi.fn();
  createToolPolicyExtension({
    ...deps,
    context: deps.context ?? decisionContext,
  })({ on } as unknown as ExtensionAPI);
  return on;
}

describe('createToolPolicyExtension', () => {
  const analyzer = analyzerStub({
    'git status': ['git'],
    'git push | curl x': ['git', 'curl'],
    'eval "$X"': { reason: 'eval' },
  });

  it('registers no handler in off mode', () => {
    const on = registerHandler({
      policy: {
        enforcement: 'off',
        allowedTools: new Set(),
        allowedShellCommands: [],
        degraded: false,
      },
      analyzer,
      logger,
    });
    expect(on).not.toHaveBeenCalled();
  });

  it('remains compatible with callers that omit decision context', () => {
    const on = vi.fn();
    createToolPolicyExtension({
      policy: {
        enforcement: 'enforce',
        allowedTools: new Set(['read']),
        allowedShellCommands: [],
        degraded: false,
      },
      analyzer,
      logger,
    })({ on } as unknown as ExtensionAPI);
    const handler = on.mock.calls[0][1] as (e: ToolCallEvent) => unknown;

    expect(handler(toolCall('read', { path: 'README.md' }))).toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'allowed',
        reason: 'policy_allowed',
      }),
      'tool_policy.allowed',
    );
  });

  it('blocks a disallowed bash executable in enforce', () => {
    const policy: SessionToolPolicy = {
      enforcement: 'enforce',
      allowedTools: new Set(['git']),
      allowedShellCommands: [],
      degraded: false,
    };
    const on = registerHandler({ policy, analyzer, logger });
    const handler = on.mock.calls[0][1] as (e: ToolCallEvent) => unknown;

    const blocked = handler(toolCall('bash', { command: 'git push | curl x' }));
    expect(blocked).toMatchObject({ block: true });
    expect((blocked as { reason: string }).reason).toContain('curl');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        degraded: false,
        taskId: 'task-1',
        attemptN: 2,
        teamId: 'team-1',
        decision: 'blocked',
        reason: 'tool_not_permitted',
        claimPolicySnapshotHash: CLAIM_POLICY_HASH,
        executionPolicySnapshotHash: undefined,
      }),
      'tool_policy.blocked',
    );

    const allowed = handler(toolCall('bash', { command: 'git status' }));
    expect(allowed).toBeUndefined();
  });

  it('audits (allows) a disallowed tool in watch', () => {
    const on = registerHandler({
      policy: {
        enforcement: 'watch',
        allowedTools: new Set(['git']),
        allowedShellCommands: [],
        degraded: false,
      },
      analyzer,
      logger,
    });
    const handler = on.mock.calls[0][1] as (e: ToolCallEvent) => unknown;

    const result = handler(toolCall('write', { path: 'x' }));
    expect(result).toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'write',
        decision: 'audit',
        reason: 'tool_not_permitted',
      }),
      'tool_policy.audit',
    );
  });

  it('blocks an unresolvable bash command in enforce (fail-closed)', () => {
    const on = registerHandler({
      policy: {
        enforcement: 'enforce',
        allowedTools: new Set(['git']),
        allowedShellCommands: [],
        degraded: false,
      },
      analyzer,
      logger,
    });
    const handler = on.mock.calls[0][1] as (e: ToolCallEvent) => unknown;
    expect(handler(toolCall('bash', { command: 'eval "$X"' }))).toMatchObject({
      block: true,
    });
  });

  it('does not log literal tokens from a matched configured prefix', () => {
    const secret = 'authorization: bearer top-secret';
    const command = `gh api --header "${secret}" /user`;
    const scopedAnalyzer = {
      analyze: vi.fn().mockReturnValue({
        ok: true,
        command,
        ast: '',
        tools: [
          {
            name: 'gh',
            argv: ['gh', 'api', '--header', secret, '/user'],
            risk: 'unknown',
            capabilities: [],
            raw: command,
          },
        ],
      }),
    } as unknown as ShellCommandAnalyzer;
    const on = registerHandler({
      policy: {
        enforcement: 'enforce',
        allowedTools: new Set(),
        allowedShellCommands: [
          { argvPrefix: ['gh', 'api', '--header', secret] },
        ],
        degraded: false,
      },
      analyzer: scopedAnalyzer,
      logger,
    });
    const handler = on.mock.calls[0][1] as (e: ToolCallEvent) => unknown;

    expect(handler(toolCall('bash', { command }))).toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'allowed',
        reason: 'shell_command_prefix_allowed',
        shellFingerprints: [
          expect.objectContaining({
            executable: 'gh',
            argvPrefixFingerprint: expect.stringMatching(
              /^sha256:[0-9a-f]{16}$/,
            ),
            argvPrefixLength: 4,
          }),
        ],
      }),
      'tool_policy.allowed',
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(secret);
  });

  it('logs correlated allowed decisions without tool arguments', () => {
    const policy: SessionToolPolicy = {
      enforcement: 'enforce',
      allowedTools: new Set(['write']),
      allowedShellCommands: [],
      executionPolicySnapshotHash: EXECUTION_POLICY_HASH,
      executionRuntimeProfileRevision: 7,
      degraded: false,
    };
    const on = registerHandler({ policy, analyzer, logger });
    const handler = on.mock.calls[0][1] as (e: ToolCallEvent) => unknown;
    const secret = 'sentinel-tool-argument';

    expect(handler(toolCall('write', { content: secret }))).toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        attemptN: 2,
        teamId: 'team-1',
        claimantAgentId: 'agent-1',
        leaseId: 'lease-1',
        proposerKind: 'human',
        proposerId: 'human-1',
        toolName: 'write',
        toolCallId: 'call-1',
        decision: 'allowed',
        reason: 'policy_allowed',
        enforcement: 'enforce',
        claimPolicySnapshotHash: CLAIM_POLICY_HASH,
        executionPolicySnapshotHash: EXECUTION_POLICY_HASH,
        claimRuntimeProfileRevision: 6,
        executionRuntimeProfileRevision: 7,
        claimedExecutorFingerprint: 'bafkreiexecutor',
      }),
      'tool_policy.allowed',
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(secret);
  });

  it('logs claim/execution policy drift once and keeps the gate active', () => {
    const policy: SessionToolPolicy = {
      enforcement: 'enforce',
      allowedTools: new Set(['read']),
      allowedShellCommands: [],
      executionPolicySnapshotHash: EXECUTION_POLICY_HASH,
      executionRuntimeProfileRevision: 7,
      degraded: false,
    };
    const on = registerHandler({ policy, analyzer, logger });
    const handler = on.mock.calls[0][1] as (e: ToolCallEvent) => unknown;

    expect(handler(toolCall('read', { path: 'README.md' }))).toBeUndefined();
    expect(handler(toolCall('write', { path: 'README.md' }))).toMatchObject({
      block: true,
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'continue',
        reason: 'claim_execution_policy_drift',
        claimPolicySnapshotHash: CLAIM_POLICY_HASH,
        executionPolicySnapshotHash: EXECUTION_POLICY_HASH,
      }),
      'tool_policy.snapshot_drift',
    );
    expect(
      logger.info.mock.calls.filter(
        ([, message]) => message === 'tool_policy.snapshot_drift',
      ),
    ).toHaveLength(1);
    expect(on).toHaveBeenCalledTimes(1);
  });

  it('flags degraded:true in the block log when the policy is a fallback', () => {
    const on = registerHandler({
      policy: {
        enforcement: 'enforce',
        allowedTools: new Set(),
        allowedShellCommands: [],
        degraded: true,
      },
      analyzer,
      logger,
    });
    const handler = on.mock.calls[0][1] as (e: ToolCallEvent) => unknown;
    expect(handler(toolCall('write', { path: 'x' }))).toMatchObject({
      block: true,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ degraded: true }),
      'tool_policy.blocked',
    );
  });
});
