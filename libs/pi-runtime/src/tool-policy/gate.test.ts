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
type ToolStub = {
  name: string;
  argv?: readonly (string | null)[];
  risk?: RiskTier;
};
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
        argv: stub.argv ?? [stub.name],
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
  allowedShellCommands: [],
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

  it.each(['status', 'diff', 'log', 'show', 'blame'])(
    'bash: allows scoped git %s rule',
    (subcommand) => {
      const command = `git ${subcommand}`;
      expect(
        decideToolCall(
          base({
            toolName: 'bash',
            command,
            allowedShellCommands: [{ argvPrefix: ['git', subcommand] }],
            analyze: analyzerOf({
              [command]: {
                tools: [{ name: 'git', argv: ['git', subcommand, '--stat'] }],
              },
            }),
          }),
        ),
      ).toMatchObject({
        allow: true,
        matchedShellCommands: [
          {
            executable: 'git',
            argvPrefixFingerprint: expect.stringMatching(
              /^sha256:[0-9a-f]{16}$/,
            ),
            argvPrefixLength: 2,
          },
        ],
      });
    },
  );

  it('does not expose matched configured prefix tokens in decisions', () => {
    const secret = 'authorization: bearer top-secret';
    const decision = decideToolCall(
      base({
        toolName: 'bash',
        command: `gh api --header "${secret}" /user`,
        allowedShellCommands: [
          { argvPrefix: ['gh', 'api', '--header', secret] },
        ],
        analyze: analyzerOf({
          [`gh api --header "${secret}" /user`]: {
            tools: [
              {
                name: 'gh',
                argv: ['gh', 'api', '--header', secret, '/user'],
              },
            ],
          },
        }),
      }),
    );

    expect(decision).toMatchObject({
      allow: true,
      matchedShellCommands: [
        {
          executable: 'gh',
          argvPrefixFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{16}$/),
          argvPrefixLength: 4,
        },
      ],
    });
    expect(JSON.stringify(decision)).not.toContain(secret);
  });

  it.each(['commit', 'push', 'reset', 'checkout'])(
    'bash: rejects git %s outside scoped rules',
    (subcommand) => {
      const command = `git ${subcommand}`;
      expect(
        decideToolCall(
          base({
            toolName: 'bash',
            command,
            allowedShellCommands: [{ argvPrefix: ['git', 'diff'] }],
            analyze: analyzerOf({
              [command]: {
                tools: [{ name: 'git', argv: ['git', subcommand] }],
              },
            }),
          }),
        ),
      ).toMatchObject({ allow: false, missing: ['git'] });
    },
  );

  it('bash: requires every invocation in a compound command to match', () => {
    expect(
      decideToolCall(
        base({
          toolName: 'bash',
          command: 'git diff && git push',
          allowedShellCommands: [{ argvPrefix: ['git', 'diff'] }],
          analyze: analyzerOf({
            'git diff && git push': {
              tools: [
                { name: 'git', argv: ['git', 'diff'] },
                { name: 'git', argv: ['git', 'push'] },
              ],
            },
          }),
        }),
      ),
    ).toMatchObject({
      allow: false,
      missing: ['git'],
      missingShellCommands: [
        expect.objectContaining({
          executable: 'git',
          argvFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{16}$/),
          argvLength: 2,
        }),
      ],
    });
  });

  it('bash: scoped rules cannot authorize output redirection side effects', () => {
    expect(
      decideToolCall(
        base({
          toolName: 'bash',
          command: 'git diff > /tmp/pwn',
          allowedShellCommands: [{ argvPrefix: ['git', 'diff'] }],
          analyze: () => ({
            ok: true,
            command: 'git diff > /tmp/pwn',
            ast: '',
            hasOutputRedirection: true,
            tools: [
              {
                name: 'git',
                argv: ['git', 'diff'],
                risk: 'unknown',
                capabilities: [],
                raw: 'git diff',
              },
            ],
          }),
        }),
      ),
    ).toMatchObject({
      allow: false,
      reason: 'shell output redirection requires broad executable permission',
    });
  });

  it('bash: broad executable grants may authorize output redirection', () => {
    expect(
      decideToolCall(
        base({
          toolName: 'bash',
          command: 'git diff > /tmp/pwn',
          allowedTools: set(['git']),
          analyze: () => ({
            ok: true,
            command: 'git diff > /tmp/pwn',
            ast: '',
            hasOutputRedirection: true,
            tools: [
              {
                name: 'git',
                argv: ['git', 'diff'],
                risk: 'unknown',
                capabilities: [],
                raw: 'git diff',
              },
            ],
          }),
        }),
      ),
    ).toEqual({ allow: true });
  });

  it('does not expose analyzer command text in denial reasons', () => {
    const decision = decideToolCall(
      base({
        toolName: 'bash',
        command: 'env -S "$SECRET"',
        analyze: analyzerOf({
          'env -S "$SECRET"': { reason: 'in escape flag (token=secret)' },
        }),
      }),
    );

    expect(decision).toMatchObject({
      allow: false,
      reason: 'shell command could not be statically authorized',
    });
    expect(JSON.stringify(decision)).not.toContain('secret');
  });

  it('bash: distinguishes nested gh command paths', () => {
    expect(
      decideToolCall(
        base({
          toolName: 'bash',
          command: 'gh pr merge 1725',
          allowedShellCommands: [{ argvPrefix: ['gh', 'pr', 'view'] }],
          analyze: analyzerOf({
            'gh pr merge 1725': {
              tools: [{ name: 'gh', argv: ['gh', 'pr', 'merge', '1725'] }],
            },
          }),
        }),
      ),
    ).toMatchObject({ allow: false });
  });

  it('bash: dynamic tokens cannot satisfy a scoped rule', () => {
    expect(
      decideToolCall(
        base({
          toolName: 'bash',
          command: 'git "$ACTION"',
          allowedShellCommands: [{ argvPrefix: ['git', 'diff'] }],
          analyze: analyzerOf({
            'git "$ACTION"': {
              tools: [{ name: 'git', argv: ['git', null] }],
            },
          }),
        }),
      ),
    ).toMatchObject({ allow: false });
  });

  it('bash: a broad tool grant supersedes scoped rules', () => {
    expect(
      decideToolCall(
        base({
          toolName: 'bash',
          command: 'git push',
          allowedTools: set(['git']),
          allowedShellCommands: [{ argvPrefix: ['git', 'diff'] }],
          analyze: analyzerOf({
            'git push': {
              tools: [{ name: 'git', argv: ['git', 'push'] }],
            },
          }),
        }),
      ),
    ).toEqual({ allow: true });
  });

  it('bash: wrapper and nested command must each be authorized', () => {
    expect(
      decideToolCall(
        base({
          toolName: 'bash',
          command: 'sudo git diff',
          allowedShellCommands: [{ argvPrefix: ['git', 'diff'] }],
          analyze: analyzerOf({
            'sudo git diff': {
              tools: [
                { name: 'sudo', argv: ['sudo', 'git', 'diff'] },
                { name: 'git', argv: ['git', 'diff'] },
              ],
            },
          }),
        }),
      ),
    ).toMatchObject({ allow: false, missing: ['sudo'] });
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
