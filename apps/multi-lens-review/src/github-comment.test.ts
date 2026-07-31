import { describe, expect, it } from 'vitest';

import { renderMultiLensReviewComment } from './github-comment.js';
import type { MultiLensReviewPublishedOutput } from './types.js';

function output(
  outcome: MultiLensReviewPublishedOutput['outcome'],
): MultiLensReviewPublishedOutput {
  return {
    correlationId: 'correlation',
    outcome,
    phaseOutputs: { topicReviews: [] },
    diagnostics: {
      topics: [],
      coverage: {
        reviewableFiles: ['src/change.ts'],
        excludedFiles: [],
        primaryOwners: { 'src/change.ts': 'change' },
        laneCoverage: { 'src/change.ts': ['correctness'] },
        complete: true,
      },
      cost: {
        tasks: 3,
        artifacts: 2,
        artifactBytes: 128,
        inputTokens: 10,
        outputTokens: 5,
      },
    },
  };
}

describe('renderMultiLensReviewComment', () => {
  it('publishes structured findings for completed reviews', () => {
    const result = output('completed');
    result.verdict = {
      version: 1,
      recommendation: 'request-changes',
      findings: [
        {
          severity: 'major',
          path: 'src/change.ts',
          location: '42',
          description: 'The result is incorrect.',
          impact: 'Callers receive stale data.',
          fix: 'Return the current value.',
        },
      ],
      summary: 'One change is required.',
      coverageComplete: true,
    };

    const comment = renderMultiLensReviewComment(result, 'run details');
    expect(comment).toContain('Recommendation: **request-changes**');
    expect(comment).toContain('`src/change.ts:42`');
    expect(comment).toContain('Impact: Callers receive stale data.');
    expect(comment).toContain('Fix: Return the current value.');
  });

  it.each([
    ['pivot', 'pivot before line-level review'],
    ['questions', 'What contract should this preserve?'],
  ] as const)('publishes successful %s outcomes', (outcome, expected) => {
    const result = output(outcome);
    result.preflight = {
      verdict: outcome === 'pivot' ? 'PIVOT' : 'ASK',
      summary: 'Design preflight stopped the graph.',
      ...(outcome === 'questions'
        ? { questions: ['What contract should this preserve?'] }
        : {}),
    };

    expect(renderMultiLensReviewComment(result, 'run details')).toContain(
      expected,
    );
  });
});
