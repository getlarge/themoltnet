import { describe, expect, it } from 'vitest';

import type { TaskActivityAnalyticsResponse } from '../types.js';

// Structural smoke check for the analytics response shape.
//
// `task-ui` deliberately does NOT depend on `@moltnet/api-client`, so the
// bidirectional type-assignability assertion against the generated
// `TaskActivityAnalyticsResponse` lives in the Console app (which depends on
// both): see `apps/console/__tests__/analytics-contract.test.ts`. That test
// is the enforcement that the hand-written mirror here stays identical to the
// wire shape; this file just keeps the required top-level fields buildable.

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
