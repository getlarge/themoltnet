/**
 * Turn a parsed `Scenario` into the task inputs the runtime consumes.
 *
 * These build plain `RunEvalInput` / `JudgeEvalAttemptInput` objects (validated
 * against the `@moltnet/tasks` schemas). Callers pass them straight to the SDK
 * builders (`buildRunEval`, `buildJudgeEvalAttempt`) — this keeps the pure
 * input-building path SDK-free and unit-testable without a live agent.
 *
 * The producer never receives the rubric: `buildRunEvalInput` carries only the
 * prompt + execution shape. The rubric is injected only on the judge side by
 * `buildJudgeInput`, exactly matching the hidden-key design in
 * `libs/tasks/src/task-types/run-eval.ts`.
 */
import type {
  JudgeEvalAttemptInput,
  RunEvalInput,
  SuccessCriteria,
  TaskContext,
} from '@moltnet/tasks';

import type { Scenario } from './scenario.js';

/** `variantLabel` must be 1..64 chars and (for the judge output) contain no
 * ` - ` sequence. Scenario slugs are kebab-case, so a single dash is fine; we
 * only guard the length and the forbidden ` - ` here. */
function variantLabel(slug: string, variant: string): string {
  const label = `${slug}:${variant}`;
  if (label.length > 64) {
    // Truncate deterministically; the slug is the identifying part.
    return label.slice(0, 64);
  }
  return label;
}

export interface BuildRunEvalOptions {
  /**
   * The variant this run represents. `baseline` uses empty context; any other
   * label supplies `context`. Joins runs of the same scenario under one
   * correlation id at the call site.
   */
  variant: string;
  /**
   * Context entries for this variant. Empty array (the default) IS the
   * baseline — see `RunEvalInput.context` docs. For rendered-pack A/B evals a
   * caller passes the rendered pack as a `context_inline` entry.
   */
  context?: TaskContext;
}

/**
 * Build a `run_eval` input for a scenario variant. No rubric, no
 * successCriteria — the producer must not see the judge key, and omitting
 * successCriteria keeps `output.verification` optional (see
 * `validateRunEvalOutput`).
 */
export function buildRunEvalInput(
  scenario: Scenario,
  options: BuildRunEvalOptions,
): RunEvalInput {
  return {
    scenario: { prompt: scenario.prompt },
    variantLabel: variantLabel(scenario.slug, options.variant),
    execution: scenario.execution,
    context: options.context ?? [],
  };
}

export interface BuildJudgeOptions {
  /** The accepted producer task to grade. */
  targetTaskId: string;
  /** The accepted attempt number on that task. */
  targetAttemptN: number;
}

/**
 * Build a `judge_eval_attempt` input that grades one accepted producer attempt
 * against the scenario's hidden rubric. The rubric enters the pipeline HERE and
 * only here.
 */
export function buildJudgeInput(
  scenario: Scenario,
  options: BuildJudgeOptions,
): JudgeEvalAttemptInput {
  const successCriteria: SuccessCriteria = {
    version: 1,
    rubric: scenario.rubric,
  };
  return {
    targetTaskId: options.targetTaskId,
    targetAttemptN: options.targetAttemptN,
    successCriteria,
  };
}
