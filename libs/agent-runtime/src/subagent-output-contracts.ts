/**
 * Subagent output contract.
 *
 * A "subagent output contract" is the schema a parent task's spawned
 * subagent must produce when it calls `submit_subagent_output`. Parents
 * pick the contract by **name** when invoking the `subagent` custom
 * tool (e.g. `subagent({ task, output_schema: 'judge_eval_variant_result' })`),
 * and the executor resolves the name to a TypeBox schema.
 *
 * Why a registry separate from task-type output schemas:
 *
 *   - A task type may have zero subagent contracts (most don't),
 *     exactly one (the common case for fan-out-and-collect patterns
 *     like judge_eval_variant), or several (a future planner task
 *     type might use one contract for sub-decisions and another for
 *     scout reports).
 *   - Subagent contract names are deliberately decoupled from task
 *     type names. The parent's task type produces an *Output (via
 *     submit-output-tool); the subagent submits its own structured
 *     payload, validated against this contract, NOT the parent's
 *     output schema.
 *   - The pi-extension's subagent custom tool reads contracts BY NAME
 *     (string lookup) and never imports concrete task type schema
 *     modules. Adding new contracts is a one-line registration here.
 *
 * The registry is **immutable at runtime**: it is constructed once
 * at session-setup time via `createSubagentContractRegistry([...])`
 * and injected into the subagent tool. This eliminates the previous
 * process-global Map and the accompanying reset hatch that exposed
 * test asymmetry (see #1106).
 */
import type { TSchema } from 'typebox';

export interface SubagentOutputContract {
  /** Stable identifier the parent uses to reference this contract.
   *  Lower-snake-case by convention (e.g. `judge_eval_variant_result`). */
  readonly name: string;
  /** Human-readable description shown in the subagent tool's help text
   *  and in the inner session's submit-tool description. Useful when a
   *  parent LLM has multiple contracts to choose from. */
  readonly description: string;
  /**
   * TypeBox schema the subagent's submit-tool args MUST validate
   * against. The args ARE the output payload (no `{ output: ... }`
   * wrapping), so the LLM gets field-level guidance directly.
   */
  readonly parametersSchema: TSchema;
}

export interface SubagentContractRegistry {
  /** Resolve a contract by name. Returns `null` for unknown names. */
  get(name: string): SubagentOutputContract | null;
  /** List all registered contracts. */
  list(): SubagentOutputContract[];
}

/**
 * Construct an immutable contract registry from a static list.
 *
 * The resulting registry is safe to share across sessions and
 * invocations — no mutation is possible after construction.
 */
export function createSubagentContractRegistry(
  contracts: readonly SubagentOutputContract[],
): SubagentContractRegistry {
  const lookup = new Map<string, SubagentOutputContract>();
  for (const c of contracts) {
    if (!c.name || c.name.trim().length === 0) {
      throw new Error('subagent output contract name is required');
    }
    if (!/^[a-z][a-z0-9_]*$/.test(c.name)) {
      throw new Error(
        `subagent output contract name '${c.name}' must be lower_snake_case ` +
          '(starts with a letter, then [a-z0-9_]+)',
      );
    }
    if (lookup.has(c.name)) {
      throw new Error(
        `duplicate subagent output contract name '${c.name}' in constructor args`,
      );
    }
    lookup.set(c.name, c);
  }

  return {
    get(name: string): SubagentOutputContract | null {
      return lookup.get(name) ?? null;
    },
    list(): SubagentOutputContract[] {
      return [...lookup.values()];
    },
  };
}
