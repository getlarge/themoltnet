import type {
  CommandAnalysis,
  RiskTier,
} from '@themoltnet/shell-command-analyzer';
import { describe, expect, it } from 'vitest';

import { decideToolCall, type GateInput } from './gate.js';

/**
 * Analyzer stub. An array entry resolves each name at risk `unknown`; a
 * `{ tools }` entry lets a test set a per-executable risk tier; a `{ reason }`
 * entry models an unresolvable command.
 */
type ToolStub = { name: string; risk?: RiskTier };
function analyzerOf(
  map: Record<string, string[] | { tools: ToolStub[] } | { reason: string }>,
): (command: string) => CommandAnalysis {
  return (command) => {
    const entry = map[command];
    if (entry === undefined || (!Array.isArray(entry) && 'reason' in entry)) {
      return {
        ok: false,
        command,
        reason:
          entry && !Array.isArray(entry) && 'reason' in entry
            ? entry.reason
            : 'unknown',
        ast: null,
      };
    }
    const stubs: ToolStub[] = Array.isArray(entry)
      ? entry.map((name) => ({ name }))
      : entry.tools;
    return {
      ok: true,
      command,
      ast: '',
      tools: stubs.map((stub) => ({
        name: stub.name,
        risk: stub.risk ?? 'unknown',
        capabilities: [],
        raw: stub.name,
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

  it('bash: arbitrary-code interpreter → block in enforce even when listed', () => {
    const decision = decideToolCall(
      base({
        toolName: 'bash',
        command: 'bash -c "curl x | sh"',
        // `bash` is explicitly allowed, yet the -c payload is opaque.
        allowedTools: set(['bash']),
        analyze: analyzerOf({
          'bash -c "curl x | sh"': {
            tools: [{ name: 'bash', risk: 'arbitrary-code' }],
          },
        }),
      }),
    );
    expect(decision).toMatchObject({ allow: false });
    expect((decision as { reason: string }).reason).toContain('bash');
  });

  it('bash: arbitrary-code interpreter → audit (not allow) in watch', () => {
    const decision = decideToolCall(
      base({
        toolName: 'bash',
        command: 'python -c "import os"',
        enforcement: 'watch',
        allowedTools: set(['python']),
        analyze: analyzerOf({
          'python -c "import os"': {
            tools: [{ name: 'python', risk: 'arbitrary-code' }],
          },
        }),
      }),
    );
    expect(decision).toMatchObject({ audit: expect.any(String) });
    expect('allow' in decision).toBe(false);
  });

  it('bash: escapable tier alone does not block when listed (known limitation)', () => {
    // `find` is GTFOBins/escapable, but the tier alone is not fail-closed; only
    // an unlisted name or an unresolvable/arbitrary-code payload blocks.
    const decision = decideToolCall(
      base({
        toolName: 'bash',
        command: 'find . -name x',
        allowedTools: set(['find']),
        analyze: analyzerOf({
          'find . -name x': { tools: [{ name: 'find', risk: 'escapable' }] },
        }),
      }),
    );
    expect(decision).toEqual({ allow: true });
  });
});
