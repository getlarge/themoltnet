import {
  type CommandAnalysis,
  type RiskTier,
  ShellCommandAnalyzer,
} from '@themoltnet/shell-command-analyzer';
import { beforeAll, describe, expect, it } from 'vitest';

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
let analyzeRealCommand: (command: string) => CommandAnalysis;

beforeAll(async () => {
  const analyzer = await ShellCommandAnalyzer.create();
  analyzeRealCommand = (command) => analyzer.analyze(command);
});

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
    ).toEqual({ allow: true, reasonCode: 'policy_off' });
  });

  it('enforce allows a listed structured tool', () => {
    expect(
      decideToolCall(base({ toolName: 'read', allowedTools: set(['read']) })),
    ).toEqual({ allow: true, reasonCode: 'policy_allowed' });
  });

  it('always allows the runtime-owned typed submit protocol', () => {
    expect(
      decideToolCall(
        base({
          toolName: 'submit_freeform_output',
          allowedTools: set([]),
        }),
      ),
    ).toEqual({ allow: true, reasonCode: 'executor_protocol_tool' });
  });

  it('always allows task-type-gated delegation without widening child policy', () => {
    expect(
      decideToolCall(base({ toolName: 'subagent', allowedTools: set([]) })),
    ).toEqual({ allow: true, reasonCode: 'executor_protocol_tool' });
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

  it('bash: every invocation matching a one-token rule → allow', () => {
    expect(
      decideToolCall(
        base({
          toolName: 'bash',
          command: 'git add . && git commit',
          allowedShellCommands: [{ argvPrefix: ['git'] }],
          analyze: analyzerOf({
            'git add . && git commit': {
              tools: [
                { name: 'git', argv: ['git', 'add', '.'] },
                { name: 'git', argv: ['git', 'commit'] },
              ],
            },
          }),
        }),
      ),
    ).toMatchObject({
      allow: true,
      reasonCode: 'shell_command_prefix_allowed',
    });
  });

  it('bash: an executable without a shell rule → block', () => {
    expect(
      decideToolCall(
        base({
          toolName: 'bash',
          command: 'git push | curl x',
          allowedShellCommands: [{ argvPrefix: ['git'] }],
          analyze: analyzerOf({
            'git push | curl x': {
              tools: [
                { name: 'git', argv: ['git', 'push'] },
                { name: 'curl', argv: ['curl', 'x'] },
              ],
            },
          }),
        }),
      ),
    ).toMatchObject({ allow: false, missing: ['curl'] });
  });

  it('bash: a tool grant never authorizes a shell invocation', () => {
    expect(
      decideToolCall(
        base({
          toolName: 'bash',
          command: 'git status',
          allowedTools: set(['git']),
          analyze: analyzeRealCommand,
        }),
      ),
    ).toMatchObject({
      allow: false,
      reasonCode: 'tool_not_permitted',
      missing: ['git'],
    });
  });

  it.each(['git status', 'git push origin main'])(
    'bash: a one-token git rule authorizes `%s`',
    (command) => {
      expect(
        decideToolCall(
          base({
            toolName: 'bash',
            command,
            allowedShellCommands: [{ argvPrefix: ['git'] }],
            analyze: analyzeRealCommand,
          }),
        ),
      ).toMatchObject({
        allow: true,
        reasonCode: 'shell_command_prefix_allowed',
        matchedShellCommands: [
          expect.objectContaining({ executable: 'git', argvPrefixLength: 1 }),
        ],
      });
    },
  );

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

  it('bash: a matching rule cannot authorize output redirection', () => {
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
      reasonCode: 'shell_output_redirection_not_permitted',
      reason: 'shell output redirection is not permitted by tool policy',
      missing: ['git'],
    });
  });

  it.each(['ls 2> f', 'ls > f', 'ls >> f', 'ls &> f'])(
    'bash: a one-token ls rule refuses `%s`',
    (command) => {
      expect(
        decideToolCall(
          base({
            toolName: 'bash',
            command,
            allowedShellCommands: [{ argvPrefix: ['ls'] }],
            analyze: analyzeRealCommand,
          }),
        ),
      ).toMatchObject({
        allow: false,
        reasonCode: 'shell_output_redirection_not_permitted',
        missing: ['ls'],
      });
    },
  );

  it('bash: redirection without an executable is refused', () => {
    expect(
      decideToolCall(
        base({
          toolName: 'bash',
          command: '> f',
          allowedShellCommands: [{ argvPrefix: ['ls'] }],
          analyze: () => ({
            ok: true,
            command: '> f',
            ast: '',
            hasOutputRedirection: true,
            tools: [],
          }),
        }),
      ),
    ).toMatchObject({
      allow: false,
      reasonCode: 'shell_output_redirection_not_permitted',
    });
  });

  it('bash: redirection is audited, not allowed, in watch', () => {
    const decision = decideToolCall(
      base({
        toolName: 'bash',
        command: 'ls > f',
        enforcement: 'watch',
        allowedShellCommands: [{ argvPrefix: ['ls'] }],
        analyze: analyzeRealCommand,
      }),
    );
    expect(decision).toMatchObject({
      reasonCode: 'shell_output_redirection_not_permitted',
      audit: expect.any(String),
    });
    expect('allow' in decision).toBe(false);
  });

  it.each([
    ['ls -l missing', 'ls'],
    ['grep needle missing', 'grep'],
    ['find . -fprint proof.txt', 'find'],
    ['find . -delete', 'find'],
  ])(
    'bash: a same-named tool grant does not authorize `%s`',
    (command, executable) => {
      expect(
        decideToolCall(
          base({
            toolName: 'bash',
            command,
            allowedTools: set([executable]),
            analyze: analyzeRealCommand,
          }),
        ),
      ).toMatchObject({
        allow: false,
        reasonCode: 'tool_not_permitted',
        missing: [executable],
      });
    },
  );

  it('bash: a custom tool grant does not authorize a same-named executable', () => {
    expect(
      decideToolCall(
        base({
          toolName: 'bash',
          command: 'deploy production',
          allowedTools: set(['deploy']),
          analyze: analyzerOf({
            'deploy production': {
              tools: [{ name: 'deploy', argv: ['deploy', 'production'] }],
            },
          }),
        }),
      ),
    ).toMatchObject({
      allow: false,
      reasonCode: 'tool_not_permitted',
      missing: ['deploy'],
    });
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

  it('bash: a tool grant does not widen scoped rules', () => {
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
    ).toMatchObject({ allow: false, missing: ['git'] });
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
          allowedShellCommands: [{ argvPrefix: ['eval'] }],
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
          allowedShellCommands: [{ argvPrefix: ['eval'] }],
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
    ).toEqual({ allow: true, reasonCode: 'policy_allowed' });
  });

  it('bash: authorizes the executables the analyzer resolves', () => {
    const decision = decideToolCall(
      base({
        toolName: 'bash',
        command: 'sudo apt-get update',
        allowedShellCommands: [{ argvPrefix: ['apt-get'] }],
        analyze: analyzerOf({
          'sudo apt-get update': {
            tools: [{ name: 'apt-get', argv: ['apt-get', 'update'] }],
          },
        }),
      }),
    );
    expect(decision).toMatchObject({
      allow: true,
      reasonCode: 'shell_command_prefix_allowed',
    });
  });

  it('bash: arbitrary-code interpreter → block in enforce even when listed', () => {
    const decision = decideToolCall(
      base({
        toolName: 'bash',
        command: 'bash -c "curl x | sh"',
        // `bash` has a shell rule, yet the -c payload is opaque.
        allowedShellCommands: [{ argvPrefix: ['bash'] }],
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
        allowedShellCommands: [{ argvPrefix: ['python'] }],
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

  it('bash: escapable tier alone does not block an executable with a shell rule', () => {
    // `tar` is GTFOBins/escapable, but the tier alone is not fail-closed; only
    // a missing shell rule or an unresolvable/arbitrary-code payload blocks.
    const decision = decideToolCall(
      base({
        toolName: 'bash',
        command: 'tar -tf archive.tar',
        allowedShellCommands: [{ argvPrefix: ['tar'] }],
        analyze: analyzerOf({
          'tar -tf archive.tar': {
            tools: [
              {
                name: 'tar',
                argv: ['tar', '-tf', 'archive.tar'],
                risk: 'escapable',
              },
            ],
          },
        }),
      }),
    );
    expect(decision).toMatchObject({
      allow: true,
      reasonCode: 'shell_command_prefix_allowed',
    });
  });
});
