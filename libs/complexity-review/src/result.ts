import type { Rubric } from '@moltnet/tasks';
import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';

export const ComplexityReviewOutput = Type.Object(
  {
    scores: Type.Array(
      Type.Object(
        {
          criterionId: Type.String({ minLength: 1 }),
          status: Type.Union([
            Type.Literal('pass'),
            Type.Literal('fail'),
            Type.Literal('unclear'),
          ]),
          rationale: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
    composite: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    verdict: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type ComplexityReviewOutput = Static<typeof ComplexityReviewOutput>;

export function validateComplexityReviewOutput(
  output: unknown,
  rubric: Rubric,
): ComplexityReviewOutput {
  if (!Value.Check(ComplexityReviewOutput, output)) {
    throw new Error(
      'accepted task output is not a valid ComplexityReviewOutput',
    );
  }
  if (output.scores.length !== rubric.criteria.length) {
    throw new Error('scores length does not match rubric criteria length');
  }
  let assessedWeight = 0;
  let passedWeight = 0;
  for (const [index, criterion] of rubric.criteria.entries()) {
    const score = output.scores[index];
    if (score.criterionId !== criterion.id) {
      throw new Error(`scores[${index}] has unexpected criterionId`);
    }
    if (score.status !== 'unclear') {
      assessedWeight += criterion.weight;
      if (score.status === 'pass') passedWeight += criterion.weight;
    }
  }
  const expected =
    assessedWeight === 0 ? undefined : passedWeight / assessedWeight;
  if (
    (expected === undefined && output.composite !== undefined) ||
    (expected !== undefined &&
      (output.composite === undefined ||
        Math.abs(output.composite - expected) > 1e-6))
  ) {
    throw new Error('composite does not match assessed-weight score');
  }
  return output;
}
