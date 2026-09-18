import { createHash } from 'node:crypto';

import type { ToolEnforcement } from '@moltnet/models';
import type {
  CommandAnalysis,
  RiskTier,
} from '@themoltnet/shell-command-analyzer';

import { sanitizeExecutableName } from './sanitize.js';

export type { ToolEnforcement } from '@moltnet/models';

export interface ShellCommandRule {
  argvPrefix: readonly [string, ...string[]];
}

export interface GateInput {
  /** Pi tool name (e.g. 'bash', 'read', 'write', or a custom tool id). */
  toolName: string;
  /** The shell command, when `toolName === 'bash'`. */
  command?: string;
  enforcement: ToolEnforcement;
  /**
   * Runtime and MCP tool names the policy allows. Matched against `toolName`
   * only; a tool name never authorizes a shell invocation.
   */
  allowedTools: ReadonlySet<string>;
  /**
   * Shell argv rules, the only authority for shell invocations. Each rule
   * matches the first N statically known tokens.
   */
  allowedShellCommands: readonly ShellCommandRule[];
  /**
   * Synchronous shell analyzer (`ShellCommandAnalyzer.analyze`). Injected so the
   * decision stays pure and testable; the analyzer's async WASM init happens
   * once at session start.
   */
  analyze: (command: string) => CommandAnalysis;
}

/**
 * The gate's verdict:
 * - `{ allow: true }` — let the tool run.
 * - `{ allow: false, reason }` — block it (enforce mode).
 * - `{ audit, ... }` — would-block, but proceed and record it (watch mode).
 */
export type ToolPolicyDecisionReason =
  | 'policy_off'
  | 'executor_protocol_tool'
  | 'policy_allowed'
  | 'shell_command_prefix_allowed'
  | 'shell_command_unresolvable'
  | 'arbitrary_code_interpreter'
  | 'shell_output_redirection_not_permitted'
  | 'unsafe_environment_assignment'
  | 'tool_not_permitted';

/**
 * Environment variables that decide *which* binary an argv names, or inject
 * code into whichever one runs. A `VAR=value` prefix is not argv, so no
 * argv-prefix rule can describe it: `PATH=/tmp ls -la` matches a rule granting
 * `ls -la` while running an entirely different `ls`.
 *
 * Deliberately a short list of the loader, shell and interpreter entry points,
 * not a model of every program's configuration. Program-specific variables are
 * the same long tail as the analyzer's escape-flag table, and the ones git
 * honours are included because that table already models their `-c` twins.
 * What a process can reach once running is the sandbox's job (#2025).
 */
const UNSAFE_ENV_PREFIXES = ['LD_', 'DYLD_'];
const UNSAFE_ENV_NAMES = new Set([
  // Resolution and field splitting.
  'PATH',
  'CDPATH',
  'IFS',
  // Shell startup.
  'ENV',
  'BASH_ENV',
  'SHELLOPTS',
  'BASHOPTS',
  'PS4',
  // Interpreter startup.
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'PYTHONHOME',
  'PERL5OPT',
  'PERL5LIB',
  'RUBYOPT',
  'RUBYLIB',
  'NODE_OPTIONS',
  'CLASSPATH',
  'JAVA_TOOL_OPTIONS',
  // git's program hooks, mirroring the `-c` keys in ESCAPE_FLAG_SPECS.
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_EXTERNAL_DIFF',
  'GIT_PAGER',
  'GIT_EDITOR',
  'GIT_SEQUENCE_EDITOR',
  'GIT_EXEC_PATH',
]);

function isUnsafeEnvName(name: string): boolean {
  const upper = name.toUpperCase();
  return (
    UNSAFE_ENV_NAMES.has(upper) ||
    UNSAFE_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix))
  );
}

export type GateDecision =
  | {
      allow: true;
      reasonCode: ToolPolicyDecisionReason;
      matchedShellCommands?: MatchedShellCommand[];
    }
  | {
      allow: false;
      reasonCode: ToolPolicyDecisionReason;
      reason: string;
      missing?: string[];
      missingShellCommands?: MissingShellCommand[];
    }
  | {
      reasonCode: ToolPolicyDecisionReason;
      audit: string;
      missing?: string[];
      missingShellCommands?: MissingShellCommand[];
    };

export interface MatchedShellCommand {
  executable: string;
  argvPrefixFingerprint: string;
  argvPrefixLength: number;
}

/**
 * Literal-free metadata for a shell invocation that did not match policy.
 * argv values are deliberately omitted; the fingerprint distinguishes
 * invocations without placing literal arguments in the decision.
 */
export interface MissingShellCommand {
  executable: string;
  argvFingerprint: string;
  argvLength: number;
  dynamicTokenCount: number;
}

/**
 * Decide whether a tool call is permitted by the resolved policy.
 *
 * Fail-closed in `enforce` (audited-but-allowed in `watch`, no-op in `off`) for:
 *
 * 1. **Unresolvable commands** — a `bash` command whose executables cannot be
 *    statically resolved (command substitution, `eval`, non-literal command
 *    names, unparseable input).
 * 2. **Arbitrary-code interpreters** — a `bash` command that invokes a shell or
 *    language interpreter (`bash -c`, `python`, `node`, `perl`, …; the
 *    analyzer's `arbitrary-code` risk tier). Being name-listed is NOT enough:
 *    we cannot statically see the code such an interpreter runs, so the policy's
 *    allow-set can't bound it. This is the interim conservative stance for
 *    issue #1348 — an operator who lists `bash` still cannot smuggle
 *    `bash -c "curl … | sh"` past `enforce`.
 * 3. **Unauthorized executables** — any resolved executable without a matching
 *    shell-command rule. Tool names in `allowedTools` never authorize a shell
 *    invocation.
 * 4. **Output redirection** — a `bash` command that redirects output (`>`,
 *    `2>`, `>>`, `&>`, …). No shell-command rule authorizes it; file writes go
 *    through structured tools.
 * 5. **Execution-redirecting environment prefixes** — a `VAR=value` prefix that
 *    changes which binary argv names or injects code into it (`PATH`, `LD_*`,
 *    `BASH_ENV`, …; see {@link UNSAFE_ENV_NAMES}). Such a prefix is not argv, so
 *    the matched rule would describe a different program than the one that runs.
 *    Benign assignments are unaffected.
 *
 * KNOWN LIMITATION (follow-up): the `escapable` risk tier (GTFOBins binaries
 * like `find`, `tar`, `awk` that document shell-spawn / file-write techniques)
 * is NOT blocked on the tier alone. The analyzer already re-analyzes the
 * sub-commands it can see through documented escape flags (`find -exec`,
 * `tar --to-command`, …), but techniques it cannot parse statically could still
 * escape an argv-prefix rule. Tightening `escapable` (e.g. an LLM judge or a
 * capability-aware allow-set) is tracked as future work.
 */
export function decideToolCall(input: GateInput): GateDecision {
  if (input.enforcement === 'off') {
    return { allow: true, reasonCode: 'policy_off' };
  }
  // Task-specific submit and delegation tools are part of the immutable
  // executor protocol, not operator-granted external capabilities. Runtime
  // definitions reserve these names, and `subagent` is only registered for
  // task types that opt into delegation. The child session inherits this same
  // gate, so delegation cannot widen filesystem, shell, network, or MoltNet
  // authority.
  if (input.toolName.startsWith('submit_') || input.toolName === 'subagent') {
    return { allow: true, reasonCode: 'executor_protocol_tool' };
  }

  const resolved = resolveNames(input);
  if (resolved.kind === 'unresolvable') {
    return fenced(
      input.enforcement,
      'shell_command_unresolvable',
      'shell command could not be statically authorized',
      'unresolvable shell command (watch)',
    );
  }

  // An environment prefix that can redirect execution invalidates the argv
  // rule it would otherwise satisfy, so it is refused before anything is
  // matched. Benign assignments (`LS_COLORS=x ls -la`) are untouched.
  const unsafeEnv = (resolved.envAssignments ?? []).filter(isUnsafeEnvName);
  if (unsafeEnv.length > 0) {
    return fenced(
      input.enforcement,
      'unsafe_environment_assignment',
      `environment assignment not permitted by tool policy: ${unsafeEnv.join(', ')}`,
      `would block — environment assignment (watch): ${unsafeEnv.join(', ')}`,
      unsafeEnv,
    );
  }

  // Arbitrary-code interpreters can execute code the analyzer cannot see, so a
  // name-listed interpreter is still not authorizable. Fail closed regardless
  // of the allow-set.
  const arbitraryCode = [
    ...new Set(
      resolved.tools
        .filter((tool) => tool.risk === 'arbitrary-code')
        .map((tool) => sanitizeExecutableName(tool.name)),
    ),
  ];
  if (arbitraryCode.length > 0) {
    return fenced(
      input.enforcement,
      'arbitrary_code_interpreter',
      `arbitrary-code interpreter not authorizable by tool policy: ${arbitraryCode.join(', ')}`,
      `would block — arbitrary-code interpreter (watch): ${arbitraryCode.join(', ')}`,
      arbitraryCode,
    );
  }

  if (input.toolName !== 'bash') {
    const missing = resolved.tools
      .filter((tool) => !input.allowedTools.has(tool.name))
      .map((tool) => sanitizeExecutableName(tool.name));
    if (missing.length === 0) {
      return { allow: true, reasonCode: 'policy_allowed' };
    }
    return fenced(
      input.enforcement,
      'tool_not_permitted',
      `not permitted by tool policy: ${missing.join(', ')}`,
      `would block (watch): ${missing.join(', ')}`,
      missing,
    );
  }

  const matchedShellCommands: MatchedShellCommand[] = [];
  const missingShellCommands = resolved.tools
    .filter((tool) => {
      const matched = input.allowedShellCommands.find((rule) =>
        matchesArgvPrefix(tool.argv, rule.argvPrefix),
      );
      if (!matched) return true;
      matchedShellCommands.push(
        toMatchedShellCommand(tool.name, matched.argvPrefix),
      );
      return false;
    })
    .map(toMissingShellCommand);

  if (missingShellCommands.length === 0 && resolved.hasOutputRedirection) {
    const executables = [
      ...new Set(matchedShellCommands.map(({ executable }) => executable)),
    ];
    return fenced(
      input.enforcement,
      'shell_output_redirection_not_permitted',
      'shell output redirection is not permitted by tool policy',
      'would block shell output redirection (watch)',
      executables.length > 0 ? executables : undefined,
      matchedShellCommands.map(
        ({
          executable,
          argvPrefixFingerprint,
          argvPrefixLength,
        }): MissingShellCommand => ({
          executable,
          argvFingerprint: argvPrefixFingerprint,
          argvLength: argvPrefixLength,
          dynamicTokenCount: 0,
        }),
      ),
    );
  }

  if (missingShellCommands.length === 0) {
    return matchedShellCommands.length > 0
      ? {
          allow: true,
          reasonCode: 'shell_command_prefix_allowed',
          matchedShellCommands,
        }
      : { allow: true, reasonCode: 'policy_allowed' };
  }

  const missing = [
    ...new Set(missingShellCommands.map(({ executable }) => executable)),
  ];
  return fenced(
    input.enforcement,
    'tool_not_permitted',
    `not permitted by tool policy: ${missing.join(', ')}`,
    `would block (watch): ${missing.join(', ')}`,
    missing,
    missingShellCommands,
  );
}

function fingerprintArgv(argv: readonly (string | null)[]): string {
  return `sha256:${createHash('sha256')
    .update(
      JSON.stringify(
        argv.map((token) => (token === null ? { dynamic: true } : token)),
      ),
    )
    .digest('hex')
    .slice(0, 16)}`;
}

function toMatchedShellCommand(
  executable: string,
  argvPrefix: readonly string[],
): MatchedShellCommand {
  return {
    executable: sanitizeExecutableName(executable),
    argvPrefixFingerprint: fingerprintArgv(argvPrefix),
    argvPrefixLength: argvPrefix.length,
  };
}

function toMissingShellCommand(tool: ResolvedTool): MissingShellCommand {
  return {
    // Model-controlled: bounded before it reaches a durable sink. The
    // fingerprint below stays the reliable identifier.
    executable: sanitizeExecutableName(tool.name),
    argvFingerprint: fingerprintArgv(tool.argv),
    argvLength: tool.argv.length,
    dynamicTokenCount: tool.argv.filter((token) => token === null).length,
  };
}

function matchesArgvPrefix(
  argv: readonly (string | null)[],
  prefix: readonly string[],
): boolean {
  return (
    argv.length >= prefix.length &&
    prefix.every(
      (token, index) => argv[index] !== null && argv[index] === token,
    )
  );
}

/**
 * Shared enforce/watch branch: block in `enforce`, audit-and-allow in `watch`.
 * `enforcement` is never `off` here (short-circuited by the caller).
 */
function fenced(
  enforcement: ToolEnforcement,
  reasonCode: ToolPolicyDecisionReason,
  blockReason: string,
  auditReason: string,
  missing?: string[],
  missingShellCommands?: MissingShellCommand[],
): GateDecision {
  if (enforcement === 'enforce') {
    return {
      allow: false,
      reasonCode,
      reason: blockReason,
      ...(missing ? { missing } : {}),
      ...(missingShellCommands?.length ? { missingShellCommands } : {}),
    };
  }
  return {
    reasonCode,
    audit: auditReason,
    ...(missing ? { missing } : {}),
    ...(missingShellCommands?.length ? { missingShellCommands } : {}),
  };
}

/** A resolved executable the gate must authorize (name + analyzer risk tier). */
interface ResolvedTool {
  name: string;
  argv: readonly (string | null)[];
  risk: RiskTier;
}

/**
 * The authorization targets for a tool call. For structured tools it is the tool
 * name itself (risk `unknown` — it is not a shell executable); for `bash` it is
 * every executable the command runs (wrappers and escaped sub-commands already
 * resolved by the analyzer), each carrying its risk tier.
 */
function resolveNames(input: GateInput):
  | {
      kind: 'names';
      tools: ResolvedTool[];
      hasOutputRedirection?: boolean;
      envAssignments?: readonly string[];
    }
  | { kind: 'unresolvable'; reason: string } {
  if (input.toolName !== 'bash') {
    return {
      kind: 'names',
      tools: [
        { name: input.toolName, argv: [input.toolName], risk: 'unknown' },
      ],
    };
  }
  const command = input.command ?? '';
  // An empty command runs nothing — no executable to authorize.
  if (!command.trim()) return { kind: 'names', tools: [] };

  const analysis = input.analyze(command);
  return analysis.ok
    ? {
        kind: 'names',
        tools: analysis.tools.map((tool) => ({
          name: tool.name,
          argv: tool.argv,
          risk: tool.risk,
        })),
        hasOutputRedirection: analysis.hasOutputRedirection === true,
        envAssignments: analysis.envAssignments,
      }
    : { kind: 'unresolvable', reason: analysis.reason };
}
