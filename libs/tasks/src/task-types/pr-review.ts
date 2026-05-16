import { type Static, Type } from '@sinclair/typebox';

import type { Rubric } from '../rubric.js';
import { validateRubricWeights } from '../rubric.js';
import { SuccessCriteria } from '../success-criteria.js';

export const PR_REVIEW_TYPE = 'pr_review' as const;

export const PrReviewSubject = Type.Object(
  {
    title: Type.String({ minLength: 1 }),
    summary: Type.String({ minLength: 1 }),
    resourceUrls: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    inspectionHints: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  },
  { $id: 'PrReviewSubject', additionalProperties: false },
);
export type PrReviewSubject = Static<typeof PrReviewSubject>;

export const PrReviewInput = Type.Object(
  {
    subject: PrReviewSubject,
    taskPrompt: Type.Optional(Type.String({ minLength: 1 })),
    successCriteria: SuccessCriteria,
  },
  { $id: 'PrReviewInput', additionalProperties: false },
);
export type PrReviewInput = Static<typeof PrReviewInput>;

export const PrReviewScore = Type.Object(
  {
    criterionId: Type.String({ minLength: 1 }),
    score: Type.Union([Type.Literal(0), Type.Literal(1)]),
    rationale: Type.String({ minLength: 1 }),
  },
  { $id: 'PrReviewScore', additionalProperties: false },
);
export type PrReviewScore = Static<typeof PrReviewScore>;

export const PrReviewOutput = Type.Object(
  {
    scores: Type.Array(PrReviewScore, { minItems: 1 }),
    composite: Type.Number({ minimum: 0, maximum: 1 }),
    verdict: Type.String({ minLength: 1 }),
  },
  { $id: 'PrReviewOutput', additionalProperties: false },
);
export type PrReviewOutput = Static<typeof PrReviewOutput>;

function requireBooleanRubric(rubric: Rubric): string | null {
  for (const criterion of rubric.criteria) {
    if (criterion.scoring !== 'boolean') {
      return (
        `pr_review requires boolean scoring for every rubric criterion; ` +
        `criterion "${criterion.id}" uses "${criterion.scoring}"`
      );
    }
  }
  return null;
}

export function validatePrReviewInput(input: unknown): string | null {
  const sc = (input as { successCriteria?: { rubric?: Rubric } })
    .successCriteria;
  if (!sc) return 'successCriteria is required for judgment tasks';
  if (!sc.rubric)
    return 'successCriteria.rubric is required for judgment tasks';
  return validateRubricWeights(sc.rubric) ?? requireBooleanRubric(sc.rubric);
}

export function validatePrReviewOutput(
  output: unknown,
  input?: unknown,
): string | null {
  if (!input) return null;

  const scores = (output as PrReviewOutput).scores;
  const rubric = (input as PrReviewInput).successCriteria.rubric;
  if (!rubric) return null;

  if (scores.length !== rubric.criteria.length) {
    return (
      `scores length ${scores.length} does not match rubric criteria length ` +
      `${rubric.criteria.length}`
    );
  }

  let composite = 0;
  for (let i = 0; i < rubric.criteria.length; i++) {
    const criterion = rubric.criteria[i];
    const score = scores[i];
    if (score.criterionId !== criterion.id) {
      return (
        `scores[${i}] has criterionId "${score.criterionId}" but rubric ` +
        `expects "${criterion.id}" in that position`
      );
    }
    composite += criterion.weight * score.score;
  }

  const claimed = (output as PrReviewOutput).composite;
  if (Math.abs(claimed - composite) > 1e-6) {
    return `composite ${claimed} does not match weighted sum ${composite.toFixed(6)}`;
  }

  return null;
}
