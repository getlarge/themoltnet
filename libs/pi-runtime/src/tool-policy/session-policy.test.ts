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

  it('short-circuits off without a network call', async () => {
    const agent = agentReturning('enforce', ['git']);
    const policy = await resolveSessionToolPolicy({
      ...params,
      agent,
      enforcement: 'off',
    });
    expect(policy).toEqual({
      enforcement: 'off',
      allowedTools: new Set(),
      allowedShellCommands: [],
      degraded: false,
    });
    expect(agent.runtimeProfiles.allowedTools).not.toHaveBeenCalled();
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
      runtimeKind: 'custom_pi',
    });

    const policy = await resolveSessionToolPolicy({
      ...params,
      agent,
      enforcement: 'enforce',
    });

    expect(policy).toEqual({
      enforcement: 'enforce',
      allowedTools: new Set(),
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
  deps: Parameters<typeof createToolPolicyExtension>[0],
) {
  const on = vi.fn();
  createToolPolicyExtension(deps)({ on } as unknown as ExtensionAPI);
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
      expect.objectContaining({ degraded: false }),
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
      expect.objectContaining({ toolName: 'write' }),
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
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        matchedShellCommands: [
          expect.objectContaining({
            executable: 'gh',
            argvPrefixFingerprint: expect.stringMatching(
              /^sha256:[0-9a-f]{16}$/,
            ),
            argvPrefixLength: 4,
          }),
        ],
      }),
      'tool_policy.shell_command_allowed',
    );
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain(secret);
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
