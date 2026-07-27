import type {
  CommandAnalysis,
  RiskTier,
} from '@themoltnet/shell-command-analyzer';

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
 * 3. **Unlisted executables** — any resolved executable not in `allowedTools`.
 *
 * KNOWN LIMITATION (follow-up): the `escapable` risk tier (GTFOBins binaries
 * like `find`, `tar`, `awk` that document shell-spawn / file-write techniques)
 * is NOT blocked on the tier alone. The analyzer already re-analyzes the
 * sub-commands it can see through documented escape flags (`find -exec`,
 * `tar --to-command`, …), but techniques it cannot parse statically could still
 * escape a name-based allow-set. Tightening `escapable` (e.g. an LLM judge or a
 * capability-aware allow-set) is tracked as future work.
 */
export function decideToolCall(input: GateInput): GateDecision {
  if (input.enforcement === 'off') return { allow: true };

  const resolved = resolveNames(input);
  if (resolved.kind === 'unresolvable') {
    return fenced(
      input.enforcement,
      `shell command could not be statically authorized: ${resolved.reason}`,
      `unresolvable shell command (watch): ${resolved.reason}`,
    );
  }

  // Arbitrary-code interpreters can execute code the analyzer cannot see, so a
  // name-listed interpreter is still not authorizable. Fail closed regardless
  // of the allow-set.
  const arbitraryCode = [
    ...new Set(
      resolved.tools
        .filter((tool) => tool.risk === 'arbitrary-code')
        .map((tool) => tool.name),
    ),
  ];
  if (arbitraryCode.length > 0) {
    return fenced(
      input.enforcement,
      `arbitrary-code interpreter not authorizable by tool policy: ${arbitraryCode.join(', ')}`,
      `would block — arbitrary-code interpreter (watch): ${arbitraryCode.join(', ')}`,
      arbitraryCode,
    );
  }

  const missing = [...new Set(resolved.tools.map((tool) => tool.name))].filter(
    (name) => !input.allowedTools.has(name),
  );
  if (missing.length === 0) return { allow: true };

  return fenced(
    input.enforcement,
    `not permitted by tool policy: ${missing.join(', ')}`,
    `would block (watch): ${missing.join(', ')}`,
    missing,
  );
}

/**
 * Shared enforce/watch branch: block in `enforce`, audit-and-allow in `watch`.
 * `enforcement` is never `off` here (short-circuited by the caller).
 */
function fenced(
  enforcement: ToolEnforcement,
  blockReason: string,
  auditReason: string,
  missing?: string[],
): GateDecision {
  if (enforcement === 'enforce') return { allow: false, reason: blockReason };
  return missing ? { audit: auditReason, missing } : { audit: auditReason };
}

/** A resolved executable the gate must authorize (name + analyzer risk tier). */
interface ResolvedTool {
  name: string;
  risk: RiskTier;
}

/**
 * The authorization targets for a tool call. For structured tools it is the tool
 * name itself (risk `unknown` — it is not a shell executable); for `bash` it is
 * every executable the command runs (wrappers and escaped sub-commands already
 * resolved by the analyzer), each carrying its risk tier.
 */
function resolveNames(
  input: GateInput,
):
  | { kind: 'names'; tools: ResolvedTool[] }
  | { kind: 'unresolvable'; reason: string } {
  if (input.toolName !== 'bash') {
    return {
      kind: 'names',
      tools: [{ name: input.toolName, risk: 'unknown' }],
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
          risk: tool.risk,
        })),
      }
    : { kind: 'unresolvable', reason: analysis.reason };
}
