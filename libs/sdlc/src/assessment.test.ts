import { describe, expect, it } from 'vitest';

import { evaluateAssessment } from './assessment.js';

const revision = {
  base: 'base',
  head: 'head',
  briefDigest: 'brief',
  policyDigest: 'policy',
};
const criteria = [
  {
    id: 'behavior',
    description: 'Behavior is correct',
    weight: 0.9,
    scoring: 'llm_score' as const,
  },
  {
    id: 'tests',
    description: 'Required regression test exists',
    weight: 0.1,
    scoring: 'boolean' as const,
  },
];
const scores = [
  {
    criterionId: 'behavior',
    score: 1,
    rationale: 'Verified against the documented example',
  },
  { criterionId: 'tests', score: 1 },
];

describe('independent assessment evidence', () => {
  it('passes only when every approved criterion passes', () => {
    expect(
      evaluateAssessment(criteria, { scores, composite: 1 }, revision),
    ).toEqual({ revision, status: 'passed' });
    expect(
      evaluateAssessment(
        criteria,
        {
          scores: [scores[0], { criterionId: 'tests', score: 0 }],
          composite: 0.9,
        },
        revision,
      ).status,
    ).toBe('failed');
  });
  it.each([
    { scores, composite: 0.5 },
    { scores: [scores[0]], composite: 1 },
    { scores: [scores[0], scores[0]], composite: 1 },
    {
      scores: [scores[0], { criterionId: 'invented', score: 1 }],
      composite: 1,
    },
    {
      scores: [{ criterionId: 'behavior', score: 1 }, scores[1]],
      composite: 1,
    },
    {
      scores: [scores[0], { criterionId: 'tests', score: 0.5 }],
      composite: 0.95,
    },
    { scores: [{ ...scores[0], score: Number.NaN }, scores[1]], composite: 1 },
  ])('rejects malformed or incomplete judgments', (output) => {
    expect(evaluateAssessment(criteria, output, revision).status).toBe(
      'incomplete',
    );
  });
});
