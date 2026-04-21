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

import { Rubric } from '../rubric.js';

export const JUDGE_PACK_TYPE = 'judge_pack' as const;

export const JudgePackInput = Type.Object(
  {
    /** Rendered pack to judge. */
    rendered_pack_id: Type.String({ format: 'uuid' }),

    /**
     * Pack the rendering came from. The judge reads source entries from
     * here to ground grounding / coverage / faithfulness assessments.
     */
    source_pack_id: Type.String({ format: 'uuid' }),

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
    criterion_id: Type.String({ minLength: 1 }),
    /** 0..1 continuous for `llm_judged`, exactly 0 or 1 for deterministic/boolean. */
    score: Type.Number({ minimum: 0, maximum: 1 }),
    /** Required for `llm_judged`, optional otherwise. */
    rationale: Type.Optional(Type.String()),
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

    /** Model id used for `llm_judged` criteria. */
    judge_model: Type.Optional(Type.String()),

    /**
     * CIDv1 of the renderer binary the judge evaluated (when available
     * via `moltnet_rendered_pack_get`). Carried forward for Promise
     * Theory provenance — matches the `judgeBinaryCid` field on
     * attestations.
     */
    renderer_binary_cid: Type.Optional(Type.String()),
  },
  { $id: 'JudgePackOutput', additionalProperties: false },
);
export type JudgePackOutput = Static<typeof JudgePackOutput>;
