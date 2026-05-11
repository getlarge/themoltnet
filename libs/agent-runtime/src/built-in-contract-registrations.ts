/**
 * Module-init registrations for built-in subagent output contracts
 * (#1087, #943).
 *
 * Importing this module for its side effect registers every built-in
 * contract in the process-global subagent contract registry. The
 * package `index.ts` imports it unconditionally so any consumer that
 * pulls `@moltnet/agent-runtime` (the executor, the daemon, tests
 * exercising `buildAgentSession`) sees the contracts available by
 * name.
 *
 * Why a separate module instead of registering inline in
 * `subagent-output-contracts.ts`:
 *
 *   - That module is the registry mechanism; it must remain
 *     decoupled from any specific contract so tests can clear and
 *     register fresh sets without pulling in built-ins.
 *   - Built-in contracts depend on schemas from `@moltnet/tasks`. We
 *     want one place to enumerate them so adding a new contract is
 *     a one-line change here.
 */
import { JudgeEvalVariantResult } from '@moltnet/tasks';

import { registerSubagentOutputContract } from './subagent-output-contracts.js';

registerSubagentOutputContract({
  name: 'judge_eval_variant_result',
  description:
    'Per-variant grading result produced by a subagent of judge_eval_variant: ' +
    'scores against the shared rubric, composite, and a 1-3 sentence verdict ' +
    'for a single variant.',
  parametersSchema: JudgeEvalVariantResult,
});
