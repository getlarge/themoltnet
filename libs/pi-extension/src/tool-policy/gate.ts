import type { CommandAnalysis } from '@themoltnet/shell-command-analyzer';

/** Enforcement mode resolved for the session's runtime profile. */
export type ToolEnforcement = 'off' | 'watch' | 'enforce';

export interface GateInput {
  /** Pi tool name (e.g. 'bash', 'read', 'write', or a custom tool id). */
  toolName: string;
  /** The shell command, when `toolName === 'bash'`. */
  command?: string;
  enforcement: ToolEnforcement;
  /** Names the policy allows (structured tool names + shell executable names). */
  allowedTools: ReadonlySet<string>;
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
export type GateDecision =
  | { allow: true }
  | { allow: false; reason: string }
  | { audit: string; missing?: string[] };

/**
 * Decide whether a tool call is permitted by the resolved policy.
 *
 * Fail-closed: in `enforce` mode a `bash` command whose executables cannot be
 * statically resolved (command substitution, `eval`, non-literal command names,
 * unparseable input) is BLOCKED. In `watch` mode the same case is audited but
 * allowed. In `off` mode everything is allowed.
 */
export function decideToolCall(input: GateInput): GateDecision {
  if (input.enforcement === 'off') return { allow: true };

  const resolved = resolveNames(input);
  if (resolved.kind === 'unresolvable') {
    return input.enforcement === 'enforce'
      ? {
          allow: false,
          reason: `shell command could not be statically authorized: ${resolved.reason}`,
        }
      : { audit: `unresolvable shell command (watch): ${resolved.reason}` };
  }

  const missing = [...new Set(resolved.names)].filter(
    (name) => !input.allowedTools.has(name),
  );
  if (missing.length === 0) return { allow: true };

  return input.enforcement === 'enforce'
    ? {
        allow: false,
        reason: `not permitted by tool policy: ${missing.join(', ')}`,
      }
    : { audit: `would block (watch): ${missing.join(', ')}`, missing };
}

/**
 * The authorization names for a tool call. For structured tools it is the tool
 * name itself; for `bash` it is every executable the command runs (wrappers and
 * escaped sub-commands already resolved by the analyzer).
 */
function resolveNames(
  input: GateInput,
):
  | { kind: 'names'; names: string[] }
  | { kind: 'unresolvable'; reason: string } {
  if (input.toolName !== 'bash') {
    return { kind: 'names', names: [input.toolName] };
  }
  const command = input.command ?? '';
  // An empty command runs nothing — no executable to authorize.
  if (!command.trim()) return { kind: 'names', names: [] };

  const analysis = input.analyze(command);
  return analysis.ok
    ? { kind: 'names', names: analysis.tools.map((tool) => tool.name) }
    : { kind: 'unresolvable', reason: analysis.reason };
}
