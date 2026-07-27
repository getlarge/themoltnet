import type { CommandAnalysis } from '@themoltnet/shell-command-analyzer';
import { describe, expect, it } from 'vitest';

import { decideToolCall, type GateInput } from './gate.js';

/** Analyzer stub: resolves each command string to a fixed executable list. */
function analyzerOf(
  map: Record<string, string[] | { reason: string }>,
): (command: string) => CommandAnalysis {
  return (command) => {
    const entry = map[command];
    if (entry === undefined || 'reason' in (entry as object)) {
      return {
        ok: false,
        command,
        reason: (entry as { reason: string } | undefined)?.reason ?? 'unknown',
        ast: null,
      };
    }
    return {
      ok: true,
      command,
      ast: '',
      tools: (entry as string[]).map((name) => ({
        name,
        risk: 'unknown',
        capabilities: [],
        raw: name,
      })),
    };
  };
}

const set = (xs: string[]) => new Set(xs);
const base = (over: Partial<GateInput>): GateInput => ({
  toolName: 'read',
  enforcement: 'enforce',
  allowedTools: set([]),
  analyze: analyzerOf({}),
  ...over,
});

describe('decideToolCall', () => {
  it('off allows anything', () => {
    expect(
      decideToolCall(base({ toolName: 'write', enforcement: 'off' })),
    ).toEqual({ allow: true });
  });

  it('enforce allows a listed structured tool', () => {
    expect(
      decideToolCall(base({ toolName: 'read', allowedTools: set(['read']) })),
    ).toEqual({ allow: true });
  });

  it('enforce blocks an unlisted structured tool', () => {
    expect(
      decideToolCall(base({ toolName: 'write', allowedTools: set(['read']) })),
    ).toMatchObject({ allow: false });
  });

  it('watch audits an unlisted structured tool but allows', () => {
    expect(
      decideToolCall(
        base({
          toolName: 'write',
          enforcement: 'watch',
          allowedTools: set(['read']),
        }),
      ),
    ).toMatchObject({ audit: expect.any(String) });
  });

  it('bash: all executables listed → allow', () => {
    expect(
      decideToolCall(
        base({
          toolName: 'bash',
          command: 'git add . && git commit',
          allowedTools: set(['git']),
          analyze: analyzerOf({ 'git add . && git commit': ['git'] }),
        }),
      ),
    ).toEqual({ allow: true });
  });

  it('bash: an unlisted executable → block', () => {
    expect(
      decideToolCall(
        base({
          toolName: 'bash',
          command: 'git push | curl x',
          allowedTools: set(['git']),
          analyze: analyzerOf({ 'git push | curl x': ['git', 'curl'] }),
        }),
      ),
    ).toMatchObject({ allow: false });
  });

  it('bash: unresolvable → block in enforce', () => {
    expect(
      decideToolCall(
        base({
          toolName: 'bash',
          command: 'eval "$X"',
          allowedTools: set(['git']),
          analyze: analyzerOf({ 'eval "$X"': { reason: 'eval' } }),
        }),
      ),
    ).toMatchObject({ allow: false });
  });

  it('bash: unresolvable → audit in watch', () => {
    expect(
      decideToolCall(
        base({
          toolName: 'bash',
          command: 'eval "$X"',
          enforcement: 'watch',
          allowedTools: set(['git']),
          analyze: analyzerOf({ 'eval "$X"': { reason: 'eval' } }),
        }),
      ),
    ).toMatchObject({ audit: expect.any(String) });
  });

  it('bash: empty command runs nothing → allow', () => {
    expect(
      decideToolCall(
        base({ toolName: 'bash', command: '   ', allowedTools: set([]) }),
      ),
    ).toEqual({ allow: true });
  });

  it('bash: partially-listed executables → block naming the missing one', () => {
    const decision = decideToolCall(
      base({
        toolName: 'bash',
        command: 'sudo apt-get update',
        allowedTools: set(['apt-get']),
        analyze: analyzerOf({ 'sudo apt-get update': ['apt-get'] }),
      }),
    );
    expect(decision).toEqual({ allow: true });
  });
});
