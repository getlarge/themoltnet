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
): AllowedToolsClient {
  return {
    runtimeProfiles: {
      allowedTools: vi.fn().mockResolvedValue({ enforcement, allowedTools }),
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

beforeEach(() => vi.clearAllMocks());

describe('resolveSessionToolPolicy', () => {
  const params = { profileId: 'R', teamId: 'T', logger };

  it('short-circuits off without a network call', async () => {
    const agent = agentReturning('enforce', ['git']);
    const policy = await resolveSessionToolPolicy({
      ...params,
      agent,
      enforcement: 'off',
    });
    expect(policy).toEqual({ enforcement: 'off', allowedTools: new Set() });
    expect(agent.runtimeProfiles.allowedTools).not.toHaveBeenCalled();
  });

  it('resolves the allow-set from the API for enforce', async () => {
    const policy = await resolveSessionToolPolicy({
      ...params,
      agent: agentReturning('enforce', ['git', 'gh']),
      enforcement: 'enforce',
    });
    expect(policy.enforcement).toBe('enforce');
    expect([...policy.allowedTools].sort()).toEqual(['gh', 'git']);
  });

  it('fails closed (empty allow-set) when the fetch fails in enforce', async () => {
    const policy = await resolveSessionToolPolicy({
      ...params,
      agent: agentFailing(),
      enforcement: 'enforce',
    });
    expect(policy).toEqual({
      enforcement: 'enforce',
      allowedTools: new Set(),
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('fails open-ish (audits) when the fetch fails in watch', async () => {
    const policy = await resolveSessionToolPolicy({
      ...params,
      agent: agentFailing(),
      enforcement: 'watch',
    });
    expect(policy).toEqual({ enforcement: 'watch', allowedTools: new Set() });
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
      policy: { enforcement: 'off', allowedTools: new Set() },
      analyzer,
      logger,
    });
    expect(on).not.toHaveBeenCalled();
  });

  it('blocks a disallowed bash executable in enforce', () => {
    const policy: SessionToolPolicy = {
      enforcement: 'enforce',
      allowedTools: new Set(['git']),
    };
    const on = registerHandler({ policy, analyzer, logger });
    const handler = on.mock.calls[0][1] as (e: ToolCallEvent) => unknown;

    const blocked = handler(toolCall('bash', { command: 'git push | curl x' }));
    expect(blocked).toMatchObject({ block: true });
    expect((blocked as { reason: string }).reason).toContain('curl');

    const allowed = handler(toolCall('bash', { command: 'git status' }));
    expect(allowed).toBeUndefined();
  });

  it('audits (allows) a disallowed tool in watch', () => {
    const on = registerHandler({
      policy: { enforcement: 'watch', allowedTools: new Set(['git']) },
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
      policy: { enforcement: 'enforce', allowedTools: new Set(['git']) },
      analyzer,
      logger,
    });
    const handler = on.mock.calls[0][1] as (e: ToolCallEvent) => unknown;
    expect(handler(toolCall('bash', { command: 'eval "$X"' }))).toMatchObject({
      block: true,
    });
  });
});
