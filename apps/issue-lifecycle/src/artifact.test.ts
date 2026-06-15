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

  it('normalizes structured review findings into revision text', () => {
    const state = parseLifecycleStateArtifact({
      artifacts: [
        {
          kind: 'issue_lifecycle_state',
          title: 'state',
          body: JSON.stringify({
            phase: 'plan_generated',
            decision: 'findings',
            summary: 'Plan needs refinement',
            findings: [
              {
                id: 'testing-approach',
                priority: 'medium',
                description: 'The test plan is too vague.',
                suggestedAction: 'Name the integration test coverage.',
              },
              'Check release notes handling.',
            ],
          }),
        },
      ],
    });

    expect(state.findings).toEqual([
      'testing-approach - medium - The test plan is too vague. - Name the integration test coverage.',
      'Check release notes handling.',
    ]);
    expect(isReviewPassed(state)).toBe(false);
  });

  it('reads PR review comment metadata', () => {
    const state = parseLifecycleStateArtifact({
      artifacts: [
        {
          kind: 'issue_lifecycle_state',
          title: 'state',
          body: JSON.stringify({
            phase: 'pr_review',
            decision: 'review_passed',
            summary: 'security review passed',
            prReviewKind: 'security',
            prReviewCommentUrl:
              'https://github.com/getlarge/themoltnet/pull/42#issuecomment-3',
            prReviewCommentBody: 'security ok',
          }),
        },
      ],
    });

    expect(state).toMatchObject({
      phase: 'pr_review',
      decision: 'review_passed',
      prReviewKind: 'security',
      prReviewCommentUrl:
        'https://github.com/getlarge/themoltnet/pull/42#issuecomment-3',
      prReviewCommentBody: 'security ok',
    });
  });

  it('rejects output without a lifecycle artifact', () => {
    expect(() => parseLifecycleStateArtifact({ artifacts: [] })).toThrow(
      /missing artifacts\[0\]\.body/,
    );
  });
});
