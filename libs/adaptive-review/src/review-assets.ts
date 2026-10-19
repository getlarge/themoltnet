import type { Rubric } from '@moltnet/tasks';

/** Trusted runtime guidance, independent of files in the reviewed repository. */
export const SECURITY_PROCEDURE = `Review the pinned diff for security regressions.
1. Enumerate changed entry points, assets, callers, trust boundaries, guards, and sinks.
2. Form concrete hypotheses tied to added or deleted lines and an attacker-controlled source or misuse condition.
3. Challenge each hypothesis against the changed branch, surrounding guards, callers, schemas, and alternate paths.
4. Confirm only a reachable boundary-to-impact chain. Mark unresolved evidence unclear and disproved candidates refuted.
5. Deduplicate by root cause. Return one confirmed, unclear, or refuted result per hunt candidate.
Do not restate dependency alerts, secret-scanner matches, missing tests, or broad review burden as security findings. Do not write files or publish comments.`;

/** Portable fallback when an enabled complexity lane has no repository rubric. */
export const DEFAULT_COMPLEXITY_RUBRIC: Rubric = {
  version: 'v2',
  rubricId: 'adaptive-generic-complexity-v1',
  scope: 'change_review',
  preamble:
    'Assess how hard the change is to review safely. Ground judgments in changed code and its callers. Mark missing evidence unclear rather than failing it.',
  criteria: [
    {
      id: 'conceptual_load',
      description:
        'Pass when concepts and control flow remain coherent enough to review locally. Fail when interacting branches or state transitions demand substantial cross-component reasoning.',
      scoring: 'boolean',
      weight: 0.4,
    },
    {
      id: 'blast_radius',
      description:
        'Pass when the change is isolated. Fail when public contracts, shared code, persistent state, or multiple consumers can propagate a regression.',
      scoring: 'boolean',
      weight: 0.35,
    },
    {
      id: 'review_evidence',
      description:
        'Pass when tests and surrounding context make the changed behavior reviewable. Fail when meaningful behavior is difficult to verify from available evidence.',
      scoring: 'boolean',
      weight: 0.25,
    },
  ],
};
