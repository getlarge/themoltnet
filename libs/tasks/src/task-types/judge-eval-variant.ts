/**
 * Compatibility shim.
 *
 * `judge_eval_variant` was the original parent/subagent eval-judge design.
 * The registered task type has been replaced by `judge_eval_attempt`, but a
 * number of tests and comments still import the old symbol names. Re-export
 * the new single-target task under the old identifiers temporarily so the
 * repo can migrate incrementally.
 */
export {
  JUDGE_EVAL_ATTEMPT_TYPE as JUDGE_EVAL_VARIANT_TYPE,
  JudgeEvalAttemptInput as JudgeEvalVariantInput,
  JudgeEvalAttemptOutput as JudgeEvalVariantOutput,
  validateJudgeEvalAttemptInput as validateJudgeEvalVariantInput,
  validateJudgeEvalAttemptInputAsync as validateJudgeEvalVariantInputAsync,
  validateJudgeEvalAttemptOutput as validateJudgeEvalVariantOutput,
} from './judge-eval-attempt.js';

export async function onCreateJudgeEvalVariant() {
  return [];
}
