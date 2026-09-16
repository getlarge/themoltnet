import { ShellCommandAnalyzer } from '@themoltnet/shell-command-analyzer';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  ESCAPE_POLICY_FIXTURES,
  TOOL_POLICY_ESCAPE_CASES,
  type ToolPolicyEscapeCase,
} from './escape-corpus.js';
import { decideToolCall, type GateDecision } from './gate.js';

let analyzer: ShellCommandAnalyzer;

beforeAll(async () => {
  analyzer = await ShellCommandAnalyzer.create();
}, 60_000);

function decide(testCase: ToolPolicyEscapeCase): GateDecision {
  const fixture = ESCAPE_POLICY_FIXTURES[testCase.policyShape];
  return decideToolCall({
    toolName: 'bash',
    command: testCase.command,
    enforcement: 'enforce',
    allowedTools: new Set(fixture.tools),
    allowedShellCommands: fixture.shellCommands,
    analyze: (command) => analyzer.analyze(command),
  });
}

const label = (testCase: ToolPolicyEscapeCase) =>
  `[${testCase.policyShape}/${testCase.technique}] ${testCase.name}`;

/** Every string leaf in a decision, ignoring field names. */
function stringValuesOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringValuesOf);
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(stringValuesOf);
  }
  return [];
}

describe('tool-policy escape corpus', () => {
  it('has unique case names', () => {
    const names = TOOL_POLICY_ESCAPE_CASES.map(({ name }) => name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(TOOL_POLICY_ESCAPE_CASES.map((c) => [label(c), c] as const))(
    'enforce: %s',
    (_name, testCase) => {
      expect(decide(testCase)).toMatchObject({
        allow: testCase.expectedAllow,
        reasonCode: testCase.reasonCode,
        ...(testCase.missing ? { missing: testCase.missing } : {}),
      });
    },
  );

  it.each(
    TOOL_POLICY_ESCAPE_CASES.filter((c) => !c.expectedAllow).map(
      (c) => [label(c), c] as const,
    ),
  )('watch audits instead of blocking: %s', (_name, testCase) => {
    const fixture = ESCAPE_POLICY_FIXTURES[testCase.policyShape];
    const decision = decideToolCall({
      toolName: 'bash',
      command: testCase.command,
      enforcement: 'watch',
      allowedTools: new Set(fixture.tools),
      allowedShellCommands: fixture.shellCommands,
      analyze: (command) => analyzer.analyze(command),
    });
    expect(decision).toMatchObject({
      reasonCode: testCase.reasonCode,
      audit: expect.any(String),
    });
    expect('allow' in decision).toBe(false);
  });

  /**
   * The decision must identify an invocation without carrying its literals.
   * That property is what lets #2275 §4 put decisions in the task record
   * without a redaction rule, and it is currently held only by convention in
   * `gate.ts` — this pins it for every case in the corpus at once.
   */
  it.each(TOOL_POLICY_ESCAPE_CASES.map((c) => [label(c), c] as const))(
    'decision carries no command literals: %s',
    (_name, testCase) => {
      const decision = decide(testCase);
      // Scan the decision's string *values* only. Field names (`missing`,
      // `reason`, …) are ours, not the caller's, and a command token that
      // happens to equal one is not a leak.
      const serialized = stringValuesOf(decision).join('\n');

      // Executable names legitimately appear in a decision; nothing else may.
      const executables = new Set<string>([
        ...('missing' in decision ? (decision.missing ?? []) : []),
        ...('missingShellCommands' in decision
          ? (decision.missingShellCommands ?? []).map((m) => m.executable)
          : []),
        ...('matchedShellCommands' in decision
          ? (decision.matchedShellCommands ?? []).map((m) => m.executable)
          : []),
      ]);

      const leaked = testCase.command
        .split(/[\s|;&()<>]+/)
        .filter((token) => token.length >= 3 && !executables.has(token))
        .filter((token) => serialized.includes(token));

      expect(leaked, `leaked literals in ${serialized}`).toEqual([]);
    },
  );
});
