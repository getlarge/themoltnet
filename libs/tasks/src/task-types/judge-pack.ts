/**
 * `judge_pack` — independently score a rendered pack against a rubric.
 *
 * output_kind: judgment
 * criteria: required (embedded `rubric` — see Phase 1 design in #852
 *   amendment and Phase 2 issue #881)
 * references: required (must reference the `render_pack` task it judges,
 *   role='judged_work')
 *
 * Step 3 of the three-session attribution loop (#875). Mirrors
 * `assess_brief` in shape, but over a rendered context pack.
 *
 * Phase 1 rubric storage: the rubric body is inlined in `input.rubric`.
 * Integrity is pinned via the task's `input_cid`. Phase 2 (#881) will
 * replace the inline body with a `rubric_cid` referencing a `rubrics`
 * table row; the denormalized `criteria[]` projection stays for prompt
 * building without a fetch.
 *
 * The judge MUST be a different agent from the renderer. Enforced at
 * claim time by the runtime, not in the wire schema.
 */
import { type Static, Type } from '@sinclair/typebox';

import { AssertionResult, Rubric } from '../rubric.js';

export const JUDGE_PACK_TYPE = 'judge_pack' as const;

export const JudgePackInput = Type.Object(
  {
    /** Rendered pack to judge. */
    renderedPackId: Type.String({ format: 'uuid' }),

    /**
     * Pack the rendering came from. The judge reads source entries from
     * here to ground grounding / coverage / faithfulness assessments.
     */
    sourcePackId: Type.String({ format: 'uuid' }),

    /**
     * Full rubric body, inlined. See #852 amendment for rationale.
     * In Phase 2 (#881) this is replaced by `rubric_cid` pointing to a
     * stored row; the criteria projection will remain denormalized.
     */
    rubric: Rubric,
  },
  { $id: 'JudgePackInput', additionalProperties: false },
);
export type JudgePackInput = Static<typeof JudgePackInput>;

/** One scored criterion. Mirrors `AssessBriefScore`. */
export const JudgePackScore = Type.Object(
  {
    criterionId: Type.String({ minLength: 1 }),
    /**
     * Per-criterion numeric score, 0..1.
     * - `llm_score`: continuous 0..1 (smooths failures — see #999).
     * - `llm_checklist`: derived — `1` iff every entry in `assertions`
     *   has `passed: true`, else `0`. The judge MUST set this consistently
     *   with the assertions array; the runtime rejects mismatches.
     * - `boolean` / `deterministic_*`: exactly 0 or 1.
     */
    score: Type.Number({ minimum: 0, maximum: 1 }),
    /** Required for `llm_score`, optional otherwise. */
    rationale: Type.Optional(Type.String()),
    /**
     * Per-claim binary results — REQUIRED when the criterion's `scoring`
     * mode is `llm_checklist`, otherwise omitted. The list is the
     * dataset for cluster-analysis of failure modes; every entry carries
     * concrete `evidence` regardless of pass/fail. See #999 and the
     * shared `AssertionResult` type in `../rubric.ts`.
     */
    assertions: Type.Optional(Type.Array(AssertionResult, { minItems: 1 })),
    /**
     * Structured evidence for deterministic scorings. Shape depends on
     * the criterion's `scoring` mode; stored as free-form JSON for
     * forward compatibility.
     */
    evidence: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { $id: 'JudgePackScore', additionalProperties: false },
);
export type JudgePackScore = Static<typeof JudgePackScore>;

export const JudgePackOutput = Type.Object(
  {
    /** Per-criterion scores, same order/length as input.rubric.criteria. */
    scores: Type.Array(JudgePackScore, { minItems: 1 }),

    /** Σ(weight_i × score_i). Server rejects mismatches against the rubric. */
    composite: Type.Number({ minimum: 0, maximum: 1 }),

    /** 1–3 sentence overall verdict. */
    verdict: Type.String({ minLength: 1 }),

    /** Model id used for `llm_score` criteria. */
    judgeModel: Type.Optional(Type.String()),

    /**
     * CIDv1 of the renderer binary the judge evaluated (when available
     * via `moltnet_rendered_pack_get`). Carried forward for Promise
     * Theory provenance — matches the `judgeBinaryCid` field on
     * attestations. `null` is accepted and treated as "unavailable"
     * equivalent to omission.
     */
    rendererBinaryCid: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  },
  { $id: 'JudgePackOutput', additionalProperties: false },
);
export type JudgePackOutput = Static<typeof JudgePackOutput>;

/**
 * Cross-field validator for JudgePackOutput. Run after the TypeBox
 * schema check passes. Enforces invariants the schema can't express:
 *
 * 1. If a `JudgePackScore` carries an `assertions` array (i.e. the
 *    judge ran the criterion in `llm_checklist` mode), its numeric
 *    `score` MUST equal `1` if every `assertions[i].passed` is true,
 *    else `0`. The prompt instructs the judge to derive `score` from
 *    the array, but the LLM can drift — without this check, the
 *    runtime accepts inconsistent payloads and propagates them into
 *    composite scores and judge attestations (#999 P1).
 *
 * 2. If `score` is exactly `1` AND `assertions` is present, every
 *    assertion must have `passed: true`. Catches the failure mode in
 *    the issue: "score: 1 with a failing assertion accepted."
 *
 * Cross-rubric checks (e.g. "did the judge populate `assertions` for
 * every criterion the rubric marked `llm_checklist`?") require the
 * input rubric and live in a separate, runtime-side validator. This
 * one is rubric-agnostic on purpose — it catches within-score
 * inconsistency without needing the original task input.
 */
export function validateJudgePackOutput(output: unknown): string | null {
  // Schema validation already ran at this point — narrow safely.
  const scores = (output as JudgePackOutput).scores;
  for (let i = 0; i < scores.length; i++) {
    const s = scores[i];
    if (!s.assertions) continue;
    const allPassed = s.assertions.every((a) => a.passed);
    const expected = allPassed ? 1 : 0;
    if (s.score !== expected) {
      return (
        `scores[${i}] (criterionId="${s.criterionId}"): ` +
        `assertions ${allPassed ? 'all pass' : 'have at least one fail'} ` +
        `but score=${s.score}. Score must be derived: 1 iff every ` +
        `assertion passes, else 0 (#999 llm_checklist rule).`
      );
    }
  }
  return null;
}
