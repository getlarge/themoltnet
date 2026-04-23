/**
 * `assess_brief` — independently evaluate a fulfilled brief.
 *
 * output_kind: judgment
 * criteria: required (rubric lives as a diary entry with tag='rubric';
 *   the Task's `criteria_cid` points at that entry)
 * references: required (must reference the target `fulfill_brief` task)
 *
 * The assessor is a different agent from the producer (enforced by the
 * server / runtime at claim time — not in the wire schema).
 */
import { type Static, Type } from '@sinclair/typebox';

export const ASSESS_BRIEF_TYPE = 'assess_brief' as const;

/**
 * One criterion lifted from the rubric. Denormalized into the input so the
 * assessor prompt can be built without a second fetch; the `criteria_cid`
 * on the Task row remains authoritative for verification.
 */
export const AssessBriefCriterion = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    /** 0..1 inclusive. Weights across criteria should sum to 1 (checked client-side). */
    weight: Type.Number({ minimum: 0, maximum: 1 }),
    /**
     * How the assessor must score:
     *   - `llm_judged`: 0..1 continuous, justified in `rationale`.
     *   - `boolean`: 0 or 1, no LLM discretion.
     *   - `deterministic_signature_check`: verifier runs a signature check;
     *     result is 0 or 1. Used for criteria like "every commit has a
     *     valid Ed25519 diary signature."
     */
    scoring: Type.Union([
      Type.Literal('llm_judged'),
      Type.Literal('boolean'),
      Type.Literal('deterministic_signature_check'),
    ]),
  },
  { $id: 'AssessBriefCriterion', additionalProperties: false },
);
export type AssessBriefCriterion = Static<typeof AssessBriefCriterion>;

export const AssessBriefInput = Type.Object(
  {
    /** Task id of the `fulfill_brief` being judged. Also must appear in the Task's `references[]` with role='judged_work'. */
    targetTaskId: Type.String({ format: 'uuid' }),

    /** Criteria in scoring order. Must be non-empty. */
    criteria: Type.Array(AssessBriefCriterion, { minItems: 1 }),

    /** Free-text context passed to the LLM judge. Kept short. */
    rubricPreamble: Type.Optional(Type.String()),
  },
  { $id: 'AssessBriefInput', additionalProperties: false },
);
export type AssessBriefInput = Static<typeof AssessBriefInput>;

/** One score line. */
export const AssessBriefScore = Type.Object(
  {
    criterionId: Type.String({ minLength: 1 }),
    score: Type.Number({ minimum: 0, maximum: 1 }),
    /** Required for `llm_judged`; optional for `boolean`/`deterministic_*`. */
    rationale: Type.Optional(Type.String()),
    /** Present only for `deterministic_signature_check`. */
    evidence: Type.Optional(
      Type.Object(
        {
          commitsVerified: Type.Number(),
          commitsTotal: Type.Number(),
          signatureFailures: Type.Array(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { $id: 'AssessBriefScore', additionalProperties: false },
);
export type AssessBriefScore = Static<typeof AssessBriefScore>;

export const AssessBriefOutput = Type.Object(
  {
    /** Per-criterion scores, same order/length as input.criteria. */
    scores: Type.Array(AssessBriefScore, { minItems: 1 }),

    /** Σ(weight_i * score_i). Recomputed by the assessor and checked client-side. */
    composite: Type.Number({ minimum: 0, maximum: 1 }),

    /** 1–3 sentence overall verdict. */
    verdict: Type.String({ minLength: 1 }),

    /** Model identifier used for `llm_judged` criteria, for auditability. */
    judgeModel: Type.Optional(Type.String()),
  },
  { $id: 'AssessBriefOutput', additionalProperties: false },
);
export type AssessBriefOutput = Static<typeof AssessBriefOutput>;
