import type {
  TaskActivityAnalyticsResponse,
  TaskActivityProductMetrics,
} from './types.js';

/** A realistic metrics block for tests, demos, and the mock adapter. */
export function makeMetrics(
  overrides: Partial<TaskActivityProductMetrics> = {},
): TaskActivityProductMetrics {
  const base: TaskActivityProductMetrics = {
    success: {
      taskCount: 128,
      acceptedTaskCount: 104,
      acceptedOutputRate: 104 / 128,
      firstAttemptAcceptedTaskCount: 71,
      firstAttemptAcceptedRate: 71 / 128,
      retryRecoveredTaskCount: 33,
      retryRecoveryRate: 33 / 128,
      terminalFailureTaskCount: 12,
      terminalFailureRate: 12 / 128,
    },
    productivity: {
      attemptCount: 176,
      acceptedTasksPerDay: 14.9,
      averageAttemptsPerAcceptedTask: 1.69,
      medianTimeToAcceptedMs: 92_000,
      medianTurnsPerAttempt: 6,
      medianToolCallsPerAttempt: 11,
    },
    hurdles: {
      failedAttemptCount: 18,
      timeoutAttemptCount: 4,
      abortedAttemptCount: 3,
      cancelledAttemptCount: 2,
      retryAttemptCount: 48,
      highFrictionAttemptCount: 21,
      failedToolCallCount: 37,
      failedToolCallRate: 37 / 512,
    },
    knowledge: {
      knowledgeToolCallCount: 210,
      entrySearchCount: 96,
      entryGetCount: 74,
      packGetCount: 40,
      knowledgeCallsPerAcceptedTask: 210 / 104,
    },
    roi: {
      totalInputTokens: 4_820_000,
      totalOutputTokens: 1_310_000,
      totalTokens: 6_130_000,
      acceptedTasksPerThousandTokens: 104 / 6130,
      tokensPerAcceptedTask: 6_130_000 / 104,
      extraAttemptCount: 48,
      extraTokensBeforeAcceptance: 1_040_000,
    },
    raw: {
      messageCount: 3_940,
      turnCount: 1_120,
      toolCallCount: 512,
      failedToolCallCount: 37,
    },
  };

  return {
    ...base,
    ...overrides,
    success: { ...base.success, ...overrides.success },
    productivity: { ...base.productivity, ...overrides.productivity },
    hurdles: { ...base.hurdles, ...overrides.hurdles },
    knowledge: { ...base.knowledge, ...overrides.knowledge },
    roi: { ...base.roi, ...overrides.roi },
    raw: { ...base.raw, ...overrides.raw },
  };
}

/** An all-zero metrics block — the "empty cohort" edge case. */
export function makeEmptyMetrics(): TaskActivityProductMetrics {
  return {
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
  };
}

/** A full response with daily-trend groups, for demos and tests. */
export function makeResponse(
  overrides: Partial<TaskActivityAnalyticsResponse> = {},
): TaskActivityAnalyticsResponse {
  return {
    range: {
      completedAfter: '2026-06-01T00:00:00.000Z',
      completedBefore: '2026-07-01T00:00:00.000Z',
    },
    statsComplete: true,
    overall: makeMetrics(),
    groups: [],
    ...overrides,
  };
}
