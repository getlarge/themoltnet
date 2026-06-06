import { describe, expect, it } from 'vitest';

import { isReviewPassed, parseLifecycleStateArtifact } from './artifact.js';

describe('parseLifecycleStateArtifact', () => {
  it('reads the issue_lifecycle_state freeform artifact', () => {
    const state = parseLifecycleStateArtifact({
      summary: 'done',
      artifacts: [
        {
          kind: 'issue_lifecycle_state',
          title: 'state',
          body: JSON.stringify({
            phase: 'plan_generated',
            decision: 'review_passed',
            summary: 'Plan is good',
            findings: [],
          }),
        },
      ],
    });

    expect(state).toEqual({
      phase: 'plan_generated',
      decision: 'review_passed',
      summary: 'Plan is good',
      findings: [],
    });
    expect(isReviewPassed(state)).toBe(true);
  });

  it('rejects output without a lifecycle artifact', () => {
    expect(() => parseLifecycleStateArtifact({ artifacts: [] })).toThrow(
      /missing an issue_lifecycle_state/,
    );
  });
});
