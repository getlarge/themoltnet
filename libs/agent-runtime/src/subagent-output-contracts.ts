/**
 * Subagent output contract registry.
 *
 * A "subagent output contract" is the schema a parent task's spawned
 * subagent must produce when it calls `submit_subagent_output`. Parents
 * pick the contract by **name** when invoking the `subagent` custom
 * tool (e.g. `subagent({ task, output_schema: 'judge_eval_variant_result' })`),
 * and the executor resolves the name to a TypeBox schema here.
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
 * Layering note: `agent-runtime` can and does import from
 * `@moltnet/tasks` (e.g. for `Task`, `TaskOutput` types and the
 * existing `getTaskOutputSchema` helper). The constraint is that
 * `pi-extension` never hardcodes task-type names — and reading
 * contracts by name from this registry preserves that.
 */
import type { TSchema } from '@sinclair/typebox';

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

const REGISTRY = new Map<string, SubagentOutputContract>();

/**
 * Register a subagent output contract. Idempotent: re-registering the
 * same name with a different schema throws — contracts are meant to
 * be stable. Re-registering with the identical contract object (same
 * reference) is a no-op for HMR and test convenience.
 *
 * Typically called at module-init time alongside task-type
 * registration. See task-types/index.ts in @moltnet/tasks for the
 * conventional pattern.
 */
export function registerSubagentOutputContract(
  contract: SubagentOutputContract,
): void {
  if (!contract.name || contract.name.trim().length === 0) {
    throw new Error('subagent output contract name is required');
  }
  if (!/^[a-z][a-z0-9_]*$/.test(contract.name)) {
    throw new Error(
      `subagent output contract name '${contract.name}' must be lower_snake_case ` +
        '(starts with a letter, then [a-z0-9_]+)',
    );
  }
  const existing = REGISTRY.get(contract.name);
  if (existing && existing !== contract) {
    if (existing.parametersSchema !== contract.parametersSchema) {
      throw new Error(
        `subagent output contract '${contract.name}' is already registered ` +
          `with a different schema; refusing to override`,
      );
    }
    // Same schema, different object instance (e.g. HMR reload). Replace
    // silently; consumers reading by name are unaffected.
  }
  REGISTRY.set(contract.name, contract);
}

/**
 * Resolve a subagent output contract by name. Returns `null` for
 * unknown names — callers (the subagent custom tool) decide whether
 * that's a tool error the parent LLM can recover from or a hard fail.
 */
export function getSubagentOutputContract(
  name: string,
): SubagentOutputContract | null {
  return REGISTRY.get(name) ?? null;
}

/**
 * List all registered contracts. Useful for diagnostics and for the
 * subagent tool's parameter description so a parent LLM can see what
 * contracts are available without enumerating them in its prompt.
 */
export function listSubagentOutputContracts(): SubagentOutputContract[] {
  return [...REGISTRY.values()];
}

/**
 * Test hook: clear all registered contracts. Not exported from the
 * package's public entry point — vitest reaches in via the path
 * import. Production code MUST NOT call this.
 */
export function __resetSubagentOutputContractsForTests(): void {
  REGISTRY.clear();
}
