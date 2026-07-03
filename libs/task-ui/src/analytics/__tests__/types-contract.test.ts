import { describe, expect, it } from 'vitest';

import type { TaskActivityAnalyticsResponse } from '../types.js';

// Contract guard for the 1:1 API mirror (PR #1550).
//
// The hand-written `TaskActivityAnalyticsResponse` in `../types.js` mirrors the
// analytics endpoint's response so the generated `@moltnet/api-client` type
// drops in with no adapter. Nothing structurally forces the two to stay
// identical, so a drift (a renamed or newly-nullable field) would compile fine
// and break the "no adapter" promise silently at merge.
//
// AT MERGE (#1550): replace the placeholder below with a bidirectional
// type-assignability assertion against the generated client type, e.g.
//
//   import type { TaskActivityAnalyticsResponse as ApiResponse }
//     from '@moltnet/api-client';
//   import { expectTypeOf } from 'vitest';
//   expectTypeOf<ApiResponse>().toEqualTypeOf<TaskActivityAnalyticsResponse>();
//
// `toEqualTypeOf` (not `toMatchTypeOf`) is required so a rename or a widened
// nullability is caught in both directions. Once this passes, delete the local
// types and re-export the generated ones (see the DELETE AT MERGE note in
// types.ts).

describe('analytics response contract', () => {
  it('has the five product pillars plus range/statsComplete/groups', () => {
    // A structural smoke check until the generated type exists to assert
    // against. Constructing a value of the type here ensures the shape stays
    // buildable and documents the required top-level fields.
    const shape: Pick<
      TaskActivityAnalyticsResponse,
      'range' | 'statsComplete' | 'overall' | 'groups'
    > = {
      range: { completedAfter: '', completedBefore: '' },
      statsComplete: true,
      overall: {
        success: {
          taskCount: 0,
          acceptedTaskCount: 0,
          acceptedOutputRate: 0,
          firstAttemptAcceptedTaskCount: 0,
          firstAttemptAcceptedRate: 0,
          retryRecoveredTaskCount: 0,
          retryRecoveryRate: 0,
          terminalFailureTaskCount: 0,
          terminalFailureRate: 0,
        },
        productivity: {
          attemptCount: 0,
          acceptedTasksPerDay: 0,
          averageAttemptsPerAcceptedTask: null,
          medianTimeToAcceptedMs: null,
          medianTurnsPerAttempt: null,
          medianToolCallsPerAttempt: null,
        },
        hurdles: {
          failedAttemptCount: 0,
          timeoutAttemptCount: 0,
          abortedAttemptCount: 0,
          cancelledAttemptCount: 0,
          retryAttemptCount: 0,
          highFrictionAttemptCount: 0,
          failedToolCallCount: 0,
          failedToolCallRate: 0,
        },
        knowledge: {
          knowledgeToolCallCount: 0,
          entrySearchCount: 0,
          entryGetCount: 0,
          packGetCount: 0,
          knowledgeCallsPerAcceptedTask: null,
        },
        roi: {
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          acceptedTasksPerThousandTokens: null,
          tokensPerAcceptedTask: null,
          extraAttemptCount: 0,
          extraTokensBeforeAcceptance: 0,
        },
        raw: {
          messageCount: 0,
          turnCount: 0,
          toolCallCount: 0,
          failedToolCallCount: 0,
        },
      },
      groups: [],
    };

    expect(Object.keys(shape.overall)).toEqual([
      'success',
      'productivity',
      'hurdles',
      'knowledge',
      'roi',
      'raw',
    ]);
  });
});
