/**
 * `judge_eval_variant` — score N variants of a `run_eval` scenario
 * against a single rubric, in one pass, with per-variant subagent
 * isolation.
 *
 * output_kind: judgment
 * criteria: required (`successCriteria.rubric` — same envelope shape as
 *   `judge_pack` / `assess_brief`)
 * references: not required at the input layer — `runTaskIds` already
 *   pin the targets being graded.
 *
 * Slice 2 of #943. The parent task carries the rubric and the list of
 * variant `run_eval` task ids. The pi executor registers the generic
 * `subagent` custom tool (#1087), and the parent LLM calls
 * `subagent({ task, output_schema: 'judge_eval_variant_result' })` once
 * per variant — each child session has fresh context, fetches the
 * variant's accepted attempt output via `moltnet_get_task` /
 * `moltnet_list_task_attempts`, and grades against the rubric.
 *
 * Reuses `JudgePackScore` from `judge_pack` for per-criterion scoring
 * (Lane 1 binary via `llm_checklist`, Lane 2 graded via `llm_score`,
 * deterministic_*) — the score shape is the same across judgment
 * tasks; only the wrapping (per-variant grouping + deltas) differs.
 *
 * Cross-task input invariants — "all targets share the same
 * correlation_id, all are `run_eval`, all are completed with an
 * accepted attempt, all share byte-identical `input.successCriteria`"
 * — REQUIRE async DB lookups and live in the rest-api task-create
 * handler, not in `validateInput` (which is sync). The TypeBox layer
 * here only enforces shape: UUID format, minItems/maxItems, rubric
 * presence + weight invariant.
 */
import { type Static, Type } from '@sinclair/typebox';

import { validateRubricWeights } from '../rubric.js';
import {
  type SuccessCriteria,
  SuccessCriteria as SuccessCriteriaSchema,
} from '../success-criteria.js';
import { JudgePackScore } from './judge-pack.js';

export const JUDGE_EVAL_VARIANT_TYPE = 'judge_eval_variant' as const;

export const JudgeEvalVariantInput = Type.Object(
  {
    /**
     * IDs of the `run_eval` tasks to grade. minItems: 2 because the
     * point of this task type IS the cross-variant comparison;
     * single-variant grading should use a different mechanism.
     * maxItems: 10 caps subagent fan-out cost.
     *
     * Cross-task validators (all are `run_eval`, all completed, share
     * `correlation_id`, byte-identical `input.successCriteria`) live
     * in the rest-api task-create handler.
     */
    runTaskIds: Type.Array(Type.String({ format: 'uuid' }), {
      minItems: 2,
      maxItems: 10,
    }),

    /**
     * Required rubric envelope — duplicated from each variant
     * producer's `input.successCriteria` for clarity and to permit a
     * stricter judge-only rubric (e.g. spot-checking criteria the
     * producer was not asked to self-assess against). After #881 lands
     * this becomes a `rubricCid` lookup.
     */
    successCriteria: SuccessCriteriaSchema,
  },
  { $id: 'JudgeEvalVariantInput', additionalProperties: false },
);
export type JudgeEvalVariantInput = Static<typeof JudgeEvalVariantInput>;

/**
 * Per-variant grading. `scores[]` shape is identical to `JudgePackScore`
 * (mode-aware: binary via `llm_checklist`, graded via `llm_score`,
 * deterministic_*). Reuse the type rather than re-declare.
 *
 * This is also the **subagent output contract** — the parent's
 * `subagent` tool resolves the contract name `judge_eval_variant_result`
 * to this schema. See `agent-runtime`'s subagent contract registry.
 */
export const JudgeEvalVariantResult = Type.Object(
  {
    runTaskId: Type.String({ format: 'uuid' }),
    /** Copied from the producer task for convenience. */
    variantLabel: Type.String({ minLength: 1, maxLength: 64 }),
    scores: Type.Array(JudgePackScore, { minItems: 1 }),
    composite: Type.Number({ minimum: 0, maximum: 1 }),
    /** 1–3 sentence verdict per variant. */
    verdict: Type.String({ minLength: 1 }),
  },
  { $id: 'JudgeEvalVariantResult', additionalProperties: false },
);
export type JudgeEvalVariantResult = Static<typeof JudgeEvalVariantResult>;

export const JudgeEvalVariantOutput = Type.Object(
  {
    /**
     * Per-variant grading. Order MUST match `input.runTaskIds`. Each
     * result MUST be produced by an isolated subagent — the parent
     * LLM authors one `subagent({...})` call per variant via the
     * generic subagent custom tool (#1087).
     */
    results: Type.Array(JudgeEvalVariantResult, { minItems: 2 }),

    /**
     * Optional pairwise composite deltas. Keys are
     * `<variantLabel-A> - <variantLabel-B>` strings; values are
     * `composite(A) - composite(B)` floats. Optional — present when
     * the parent could compute them; absent when the parent prefers
     * derive-at-query-time aggregation. Imposer convention.
     */
    deltas: Type.Optional(Type.Record(Type.String(), Type.Number())),

    /** Model that drove the parent + subagent sessions. */
    judgeModel: Type.Optional(Type.String({ minLength: 1 })),
    traceparent: Type.String({ minLength: 1 }),
  },
  { $id: 'JudgeEvalVariantOutput', additionalProperties: false },
);
export type JudgeEvalVariantOutput = Static<typeof JudgeEvalVariantOutput>;

/**
 * Synchronous input invariants beyond TypeBox shape: rubric must be
 * present (already required by the schema, but the rubric body has
 * its own per-criterion weight invariant) and the rubric's weights
 * must sum to 1.
 *
 * Cross-task invariants (all targets are `run_eval`, all completed,
 * share `correlation_id`, byte-identical `input.successCriteria`) are
 * NOT checked here — they require async DB lookups against
 * `runTaskIds` and live in the rest-api task-create handler.
 */
export function validateJudgeEvalVariantInput(input: unknown): string | null {
  const sc = (input as { successCriteria?: SuccessCriteria }).successCriteria;
  if (!sc) {
    return 'successCriteria is required for judge_eval_variant';
  }
  if (!sc.rubric) {
    return 'successCriteria.rubric is required for judge_eval_variant';
  }
  return validateRubricWeights(sc.rubric);
}

/**
 * Output cross-field invariants the schema cannot express:
 *
 *   1. `results.length === input.runTaskIds.length` — every variant
 *      the imposer asked for must be graded. Partial grading
 *      invalidates cross-variant comparison; fail the whole task
 *      rather than silently report a subset.
 *
 *   2. `results[i].runTaskId === input.runTaskIds[i]` — order is
 *      load-bearing for downstream consumers (e.g. deltas keyed by
 *      adjacent pairs). Mismatch is an LLM bug; reject loudly.
 *
 *   3. Each `result.scores` follows the same `llm_checklist` rule
 *      `judge_pack` enforces (#999): if a score has an `assertions`
 *      array, the numeric score MUST be `1` iff every assertion
 *      passes. Inconsistent payloads pollute attestations.
 *
 *   4. Each `result.composite` MUST equal the rubric-weighted sum
 *      `Σ(weight_j × scores[j].score)`. The parent (and any subagent
 *      it delegated to) is supposed to compute this; surfacing a
 *      drift here catches LLMs that hand-wave the arithmetic.
 *
 *   5. Optional `deltas` keys MUST be of the form `"A - B"` where
 *      both `A` and `B` are variantLabels present in `results`.
 *      Values are not range-checked (any float in [-1, 1] is
 *      arithmetically possible).
 */
export function validateJudgeEvalVariantOutput(
  output: unknown,
  input?: unknown,
): string | null {
  const out = output as JudgeEvalVariantOutput;
  const inp = input as JudgeEvalVariantInput | undefined;

  // (1) + (2) require input. Without it, skip these — the server's
  // validateOutput pass always passes both, but unit tests of the
  // function itself may not.
  if (inp) {
    if (out.results.length !== inp.runTaskIds.length) {
      return (
        `results.length (${out.results.length}) does not match ` +
        `input.runTaskIds.length (${inp.runTaskIds.length}). ` +
        'Every variant must be graded; partial grading is rejected.'
      );
    }
    for (let i = 0; i < out.results.length; i++) {
      if (out.results[i].runTaskId !== inp.runTaskIds[i]) {
        return (
          `results[${i}].runTaskId (${out.results[i].runTaskId}) ` +
          `does not match input.runTaskIds[${i}] (${inp.runTaskIds[i]}). ` +
          'Order must align with input for downstream delta computation.'
        );
      }
    }
  }

  // (3) llm_checklist score↔assertions consistency, per variant.
  for (let r = 0; r < out.results.length; r++) {
    const result = out.results[r];
    for (let s = 0; s < result.scores.length; s++) {
      const sc = result.scores[s];
      if (!sc.assertions) continue;
      const allPassed = sc.assertions.every((a) => a.passed);
      const expected = allPassed ? 1 : 0;
      if (sc.score !== expected) {
        return (
          `results[${r}].scores[${s}] (criterionId="${sc.criterionId}"): ` +
          `assertions ${allPassed ? 'all pass' : 'have at least one fail'} ` +
          `but score=${sc.score}. Score must be derived: 1 iff every ` +
          'assertion passes, else 0 (#999 llm_checklist rule).'
        );
      }
    }
  }

  // (4) composite arithmetic per variant. Only checkable when we have
  // the rubric (input present) — the rubric carries the weights.
  if (inp?.successCriteria?.rubric) {
    const criteria = inp.successCriteria.rubric.criteria;
    const weightById = new Map(criteria.map((c) => [c.id, c.weight]));
    for (let r = 0; r < out.results.length; r++) {
      const result = out.results[r];
      let sum = 0;
      for (const sc of result.scores) {
        const w = weightById.get(sc.criterionId);
        // Unknown criterion id: don't accumulate. The rubric/output
        // mismatch is a separate concern (the schema permits any
        // criterionId string); judges that fabricate ids should be
        // caught upstream, not by silently distorting the composite.
        if (w === undefined) continue;
        sum += w * sc.score;
      }
      // Allow tiny FP drift; arithmetic should be exact in practice
      // because weights and scores are decimal fractions, but the
      // judge LLM may produce slightly-rounded composites.
      const drift = Math.abs(sum - result.composite);
      if (drift > 0.001) {
        return (
          `results[${r}].composite (${result.composite}) does not match ` +
          `Σ(weight × score) (${sum.toFixed(6)}). ` +
          'Composite must be the rubric-weighted sum of per-criterion ' +
          'scores (drift > 0.001).'
        );
      }
    }
  }

  // (5) deltas keys: "A - B" where both are present variantLabels.
  if (out.deltas) {
    const labels = new Set(out.results.map((r) => r.variantLabel));
    for (const key of Object.keys(out.deltas)) {
      const m = /^(.+?) - (.+)$/.exec(key);
      if (!m) {
        return (
          `deltas key "${key}" is not of the form "<variantLabel-A> - <variantLabel-B>". ` +
          'Use a single space-hyphen-space separator between labels.'
        );
      }
      const [, a, b] = m;
      if (!labels.has(a) || !labels.has(b)) {
        return (
          `deltas key "${key}" references variantLabel(s) not present in results: ` +
          `${!labels.has(a) ? `"${a}" missing` : ''}${!labels.has(a) && !labels.has(b) ? ', ' : ''}${!labels.has(b) ? `"${b}" missing` : ''}`
        );
      }
    }
  }

  return null;
}
