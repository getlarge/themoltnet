/**
 * Built-in subagent output contracts (#1087, #943).
 *
 * Why this is an exported function and not a module-init side
 * effect:
 *
 *   - The registry is process-global. Module-init registration
 *     fires exactly once per Node process (ESM modules are cached
 *     by URL). Tests that call `__resetSubagentOutputContractsForTests()`
 *     to start from an empty registry have no way to repopulate
 *     the built-ins without re-evaluating the module — which the
 *     cache prevents. PR #1101 review M4.
 *   - An explicit `registerBuiltInSubagentContracts()` lets the
 *     package index call it once at module load AND lets test
 *     setup hooks call it again after `__reset...`.
 *   - `registerSubagentOutputContract` is itself idempotent for
 *     identical re-registrations, so calling this function twice
 *     in the same process is safe.
 *
 * Adding a new built-in: extend the body of this function. Do not
 * call `registerSubagentOutputContract` from anywhere else in the
 * package — keeping all built-ins in one function makes the set
 * auditable.
 */
import { JudgeEvalVariantResult } from '@moltnet/tasks';

import { registerSubagentOutputContract } from './subagent-output-contracts.js';

export function registerBuiltInSubagentContracts(): void {
  registerSubagentOutputContract({
    name: 'judge_eval_variant_result',
    description:
      'Per-variant grading result produced by a subagent of judge_eval_variant: ' +
      'scores against the shared rubric, composite, and a 1-3 sentence verdict ' +
      'for a single variant.',
    parametersSchema: JudgeEvalVariantResult,
  });
}

// Eager registration so any consumer that imports `@themoltnet/agent-runtime`
// without explicitly calling the function still gets the built-ins.
// Tests that need a clean registry call `__resetSubagentOutputContractsForTests()`
// then `registerBuiltInSubagentContracts()` to repopulate.
registerBuiltInSubagentContracts();
