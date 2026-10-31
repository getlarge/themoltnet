import type {
  CommandAnalysis,
  ShellCommandAnalyzer,
} from '@themoltnet/shell-command-analyzer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type AllowedToolsClient,
  authorizeDurableToolCall,
  resolveSessionToolPolicy,
} from '../../src/tool-policy/session-policy.js';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
const EXECUTION_POLICY_HASH = `sha256:${'b'.repeat(64)}`;
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

  it('accepts one-token shell rules when cached off is refreshed to enforce, and gates with them', async () => {
    // Arrange
    const agent = agentReturning('enforce', [], [{ argvPrefix: ['git'] }]);
    const analyzer = analyzerStub({
      'git status': ['git'],
      'curl x': ['curl'],
    });

    // Act
    const policy = await resolveSessionToolPolicy({
      ...params,
      agent,
      enforcement: 'off',
    });
    const authorize = (command: string) =>
      authorizeDurableToolCall({
        policy,
        analyze: (input) => analyzer.analyze(input),
        logger,
        context: { taskId: 'task-1', attemptN: 1 },
        toolName: 'bash',
        args: { command },
        onDecision: vi.fn(async () => {}),
      });

    // Assert
    expect(policy).toMatchObject({
      enforcement: 'enforce',
      allowedShellCommands: [{ argvPrefix: ['git'] }],
      degraded: false,
    });
    expect(await authorize('git status')).toBeUndefined();
    expect(await authorize('curl x')).toEqual(expect.any(String));
  });

  it.each([
    ['an empty prefix', []],
    ['more than 8 tokens', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']],
    ['an empty token', ['git', '']],
  ])(
    'fails closed when the API returns a shell rule with %s',
    async (_label, argvPrefix) => {
      const policy = await resolveSessionToolPolicy({
        ...params,
        agent: agentReturning('enforce', [], [{ argvPrefix }]),
        enforcement: 'enforce',
      });

      expect(policy).toEqual({
        enforcement: 'enforce',
        allowedTools: new Set(),
        allowedShellCommands: [],
        degraded: true,
      });
    },
  );

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

  it('cancels a timed-out read before retrying and accepts the fresh policy', async () => {
    vi.useFakeTimers();
    try {
      const agent = agentReturning('enforce', ['git']);
      const fetch = vi.mocked(agent.runtimeProfiles.allowedTools);
      fetch.mockImplementationOnce(
        (_id, options) =>
          new Promise((_resolve, reject) => {
            options.signal!.addEventListener(
              'abort',
              () => {
                const reason: unknown = options.signal!.reason;
                reject(reason instanceof Error ? reason : new Error('Aborted'));
              },
              { once: true },
            );
          }),
      );
      const pending = resolveSessionToolPolicy({
        ...params,
        agent,
        enforcement: 'enforce',
        timeoutMs: 5,
      });
      // The deadline, then the first retry backoff.
      await vi.advanceTimersByTimeAsync(5 + 250);
      expect((await pending).degraded).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls[0][1].signal!.aborted).toBe(true);
      expect(fetch.mock.calls[1][1].signal!.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a denied policy', async () => {
    const agent = agentReturning('enforce', ['git']);
    const fetch = vi.mocked(agent.runtimeProfiles.allowedTools);
    fetch.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { statusCode: 403 }),
    );
    expect(
      (
        await resolveSessionToolPolicy({
          ...params,
          agent,
          enforcement: 'enforce',
        })
      ).degraded,
    ).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an HTTP 500', Object.assign(new Error('Internal'), { statusCode: 500 })],
    [
      'a transport failure',
      Object.assign(new Error('fetch failed'), { name: 'NetworkError' }),
    ],
  ])('retries %s and accepts the fresh policy', async (_label, failure) => {
    vi.useFakeTimers();
    try {
      const agent = agentReturning('enforce', ['git']);
      const fetch = vi.mocked(agent.runtimeProfiles.allowedTools);
      fetch.mockRejectedValueOnce(failure).mockRejectedValueOnce(failure);
      const pending = resolveSessionToolPolicy({
        ...params,
        agent,
        enforcement: 'enforce',
      });
      await vi.advanceTimersByTimeAsync(250 + 1_000);
      const policy = await pending;
      expect(policy.degraded).toBe(false);
      expect(policy.allowedTools).toEqual(new Set(['git']));
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ attempt: 2, delayMs: 1_000 }),
        'tool_policy.resolve_retry',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops retrying when the task stops during backoff', async () => {
    const agent = agentReturning('enforce', ['git']);
    const fetch = vi.mocked(agent.runtimeProfiles.allowedTools);
    fetch.mockRejectedValue(
      Object.assign(new Error('Unavailable'), { statusCode: 503 }),
    );
    const controller = new AbortController();
    const pending = resolveSessionToolPolicy({
      ...params,
      agent,
      enforcement: 'enforce',
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    controller.abort(new Error('Writer stopped'));
    expect((await pending).degraded).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('cancels a hung policy read without retrying when the task stops', async () => {
    const agent = agentHanging();
    const controller = new AbortController();
    const pending = resolveSessionToolPolicy({
      ...params,
      agent,
      enforcement: 'enforce',
      signal: controller.signal,
    });
    controller.abort(new Error('Writer stopped'));
    expect((await pending).degraded).toBe(true);
    expect(agent.runtimeProfiles.allowedTools).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(agent.runtimeProfiles.allowedTools).mock.calls[0][1].signal!
        .aborted,
    ).toBe(true);
  });

  it('times out a hung fetch and falls back to the degraded enforce policy', async () => {
    const agent = agentHanging();
    vi.useFakeTimers();
    let policy: Awaited<ReturnType<typeof resolveSessionToolPolicy>>;
    try {
      const pending = resolveSessionToolPolicy({
        ...params,
        agent,
        enforcement: 'enforce',
        timeoutMs: 5,
      });
      // Three deadlines with two retry backoffs between them.
      await vi.advanceTimersByTimeAsync(3 * 5 + 250 + 1_000);
      policy = await pending;
    } finally {
      vi.useRealTimers();
    }
    expect(policy).toEqual({
      enforcement: 'enforce',
      allowedTools: new Set(),
      allowedShellCommands: [],
      degraded: true,
    });
    expect(agent.runtimeProfiles.allowedTools).toHaveBeenCalledTimes(3);
    expect(
      vi
        .mocked(agent.runtimeProfiles.allowedTools)
        .mock.calls.every(([, options]) => options.signal!.aborted),
    ).toBe(true);
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

describe('authorizeDurableToolCall', () => {
  const analyzer = analyzerStub({ 'deploy production': ['deploy'] });
  const authorize = (
    enforcement: 'watch' | 'enforce',
    toolName: string,
    args: Record<string, unknown>,
    onDecision = vi.fn(async () => {}),
  ) =>
    authorizeDurableToolCall({
      policy: {
        enforcement,
        allowedTools: new Set(['read']),
        allowedShellCommands: [],
        degraded: false,
        executionPolicySnapshotHash: 'sha256:feedface',
        executionRuntimeProfileRevision: 9,
      },
      analyze: (command) => analyzer.analyze(command),
      logger,
      context: { taskId: 'task-1', attemptN: 2 },
      toolName,
      args,
      onDecision,
    });

  it('reports a refusal to the task record before blocking', async () => {
    const onDecision = vi.fn(async () => {});
    const block = await authorize(
      'enforce',
      'bash',
      { command: 'deploy production' },
      onDecision,
    );

    expect(block).toEqual(expect.any(String));
    expect(onDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'blocked',
        tool_name: 'bash',
        reason_code: 'tool_not_permitted',
        enforcement: 'enforce',
        unauthorized_executables: ['deploy'],
        shell_fingerprints: [expect.objectContaining({ executable: 'deploy' })],
        degraded: false,
        policy_snapshot_hash: 'sha256:feedface',
        runtime_profile_revision: 9,
      }),
    );
    expect(JSON.stringify(onDecision.mock.calls)).not.toContain('production');
  });

  it('reports a watch-mode refusal as would_block and lets it run', async () => {
    const onDecision = vi.fn(async () => {});
    expect(
      await authorize(
        'watch',
        'bash',
        { command: 'deploy production' },
        onDecision,
      ),
    ).toBeUndefined();
    expect(onDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'would_block',
        enforcement: 'watch',
      }),
    );
  });

  it('does not report allowed calls', async () => {
    const onDecision = vi.fn(async () => {});
    expect(
      await authorize('enforce', 'read', { path: 'README.md' }, onDecision),
    ).toBeUndefined();
    expect(onDecision).not.toHaveBeenCalled();
  });

  it('logs policy provenance with each decision but no tool arguments', async () => {
    await authorize('enforce', 'read', { path: 'sentinel-tool-argument' });

    expect(logger.info).toHaveBeenCalledWith(
      {
        taskId: 'task-1',
        attemptN: 2,
        enforcement: 'enforce',
        degraded: false,
        executionPolicySnapshotHash: 'sha256:feedface',
        executionRuntimeProfileRevision: 9,
        toolName: 'read',
        decision: 'allowed',
        reason: 'policy_allowed',
      },
      'tool_policy.allowed',
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(
      'sentinel-tool-argument',
    );
  });

  it('flags a fallback policy as degraded in the block log', async () => {
    const block = await authorizeDurableToolCall({
      policy: {
        enforcement: 'enforce',
        allowedTools: new Set(),
        allowedShellCommands: [],
        degraded: true,
      },
      analyze: (command) => analyzer.analyze(command),
      logger,
      context: { taskId: 'task-1', attemptN: 2 },
      toolName: 'write',
      args: { path: 'x' },
      onDecision: vi.fn(async () => {}),
    });

    expect(block).toEqual(expect.any(String));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ degraded: true }),
      'tool_policy.blocked',
    );
  });

  it('does not log literal tokens from a matched configured prefix', async () => {
    const secret = 'authorization: bearer top-secret';
    const command = `gh api --header "${secret}" /user`;
    const analyze = vi.fn().mockReturnValue({
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
    });

    const block = await authorizeDurableToolCall({
      policy: {
        enforcement: 'enforce',
        allowedTools: new Set(),
        allowedShellCommands: [
          { argvPrefix: ['gh', 'api', '--header', secret] },
        ],
        degraded: false,
      },
      analyze,
      logger,
      context: { taskId: 'task-1', attemptN: 2 },
      toolName: 'bash',
      args: { command },
      onDecision: vi.fn(async () => {}),
    });

    expect(block).toBeUndefined();
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

  it('keeps the verdict when the task record cannot be written', async () => {
    const block = await authorize(
      'enforce',
      'bash',
      { command: 'deploy production' },
      vi.fn(async () => {
        throw new Error('reporter down');
      }),
    );
    expect(block).toEqual(expect.any(String));
    expect(logger.warn).toHaveBeenCalledWith(
      { err: 'reporter down' },
      'tool_policy.decision_report_failed',
    );
  });
});
