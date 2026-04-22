/**
 * Rubric — structured acceptance criteria used by judgment tasks.
 *
 * Phase 1 (this PR): rubrics are embedded in task inputs. Their integrity
 * is pinned via the task's `input_cid` (which covers the whole input,
 * including the inline rubric). No separate storage, no CRUD.
 *
 * Phase 2 (see #881): rubrics become a first-class resource with their
 * own signed rows and CIDv1 lookup. The schema below is designed to
 * carry forward unchanged — only storage and addressing differ.
 *
 * Until Phase 2 lands, `rubric_id` + `version` + `content_hash` are
 * informational fields the author fills in; no uniqueness is enforced.
 * `content_hash` is optional in Phase 1 because the *task*'s input_cid
 * is the authoritative commitment.
 */
import { type Static, Type } from '@sinclair/typebox';

/**
 * How a judge must score a single criterion.
 *
 * - `llm_judged`: 0..1 continuous, `rationale` required.
 * - `boolean`: 0 or 1, `rationale` optional.
 * - `deterministic_signature_check`: judge runs a signature check;
 *   result is 0 or 1. No LLM discretion.
 * - `deterministic_coverage_check`: every referenced source entry
 *   appears in the rendered output; 0 or 1.
 */
export const RubricScoringMode = Type.Union(
  [
    Type.Literal('llm_judged'),
    Type.Literal('boolean'),
    Type.Literal('deterministic_signature_check'),
    Type.Literal('deterministic_coverage_check'),
  ],
  { $id: 'RubricScoringMode' },
);
export type RubricScoringMode = Static<typeof RubricScoringMode>;

export const RubricCriterion = Type.Object(
  {
    /** Stable within a rubric (e.g. 'coverage'). Used as the score key. */
    id: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    /** 0..1 inclusive. Weights across criteria should sum to 1 (checked client-side). */
    weight: Type.Number({ minimum: 0, maximum: 1 }),
    scoring: RubricScoringMode,
  },
  { $id: 'RubricCriterion', additionalProperties: false },
);
export type RubricCriterion = Static<typeof RubricCriterion>;

/**
 * A complete rubric. Same shape used in Phase 1 (inline) and Phase 2
 * (stored row `body`); only the addressing mechanism differs.
 */
export const Rubric = Type.Object(
  {
    /** Namespace within an author — e.g. 'pack-fidelity'. */
    rubric_id: Type.String({ minLength: 1 }),
    /** Monotonic version per `rubric_id`. Prose like 'v1'. */
    version: Type.String({ minLength: 1 }),
    /** Free-text preamble prepended to the judge's prompt. Kept short. */
    preamble: Type.Optional(Type.String()),
    /** Non-empty list of criteria. */
    criteria: Type.Array(RubricCriterion, { minItems: 1 }),
    /**
     * Applicability hint — e.g. 'packs', 'commits', 'briefs'.
     * Purely documentary in Phase 1; used as a filter index in Phase 2.
     */
    scope: Type.Optional(Type.String()),
    /**
     * Phase-2 artefact: CIDv1 of the canonical rubric body. Optional in
     * Phase 1; when Phase 2 lands the server computes & enforces it.
     */
    content_hash: Type.Optional(Type.String()),
  },
  { $id: 'Rubric', additionalProperties: false },
);
export type Rubric = Static<typeof Rubric>;

/**
 * Verify rubric criteria weights sum to 1.0 within floating-point tolerance.
 * The schema constrains each weight to [0,1] but can't express a cross-field
 * sum constraint, so this is enforced programmatically by callers that
 * accept rubrics (task input validators, server-side task creation).
 *
 * Returns null when valid; otherwise an error message suitable for surfacing
 * to the caller. Tolerance is 1e-6 to accommodate JSON round-tripping of
 * decimal fractions (e.g. 0.1 + 0.2 + 0.3 + 0.4 ≠ 1.0 exactly).
 */
export function validateRubricWeights(rubric: Rubric): string | null {
  const sum = rubric.criteria.reduce((acc, c) => acc + c.weight, 0);
  if (Math.abs(sum - 1) > 1e-6) {
    return `Rubric weights must sum to 1.0 (got ${sum.toFixed(6)})`;
  }
  return null;
}
