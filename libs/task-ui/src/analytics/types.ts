// Analytics data-boundary contract.
//
// These types mirror the API in PR #1550 1:1
// (`GET /tasks/analytics/activity` → `TaskActivityAnalyticsResponse`). Keeping
// the UI shape identical to the wire shape means that, once the API merges, the
// generated `@moltnet/api-client` type drops in with no adapter. The backend
// pre-aggregates `task_messages` into a materialized stats table, so the UI
// never touches raw messages.
//
// These types are kept hand-written (rather than re-exported from
// `@moltnet/api-client`) on purpose: `task-ui` must not depend on the API
// client — the coupling is a compile-time structural check, not a module edge.
// A bidirectional type-assignability test in the Console app
// (`apps/console/__tests__/analytics-contract.test.ts`) locks these to the
// generated wire type, so a silent drift (a renamed or newly-nullable field)
// fails the build there instead of breaking the "no adapter" flow at runtime.

/** Pivot dimension for the comparison table + daily trend bucketing. */
export type AnalyticsGroupBy =
  | 'none'
  | 'day'
  | 'tag'
  | 'taskType'
  | 'profile'
  | 'diary'
  | 'agent'
  | 'providerModel';

/**
 * Filters accepted by the analytics endpoint. All optional; the repeated
 * filters are multi-value. Tags are the primary cohort lens; task type and the
 * id filters are secondary narrowing.
 */
export interface AnalyticsFilters {
  completedAfter?: string; // ISO-8601
  completedBefore?: string; // ISO-8601
  tags?: string[];
  taskTypes?: string[];
  profileIds?: string[];
  diaryIds?: string[];
  claimedByAgentIds?: string[];
  groupBy?: AnalyticsGroupBy;
}

/**
 * The five-pillar product metrics, computed for the aggregate window and for
 * each group. Mirrors the API's `TaskActivityProductMetrics`.
 *
 * Rates are always in [0, 1] (never null) and pair with a sibling count so the
 * UI can show "82% (41/50)". Only ratios and medians are nullable — null means
 * "unknown / not enough data" (e.g. no accepted tasks → tokens-per-accepted is
 * null), which is distinct from a real 0.
 */
export interface TaskActivityProductMetrics {
  /** Q1 — Does it succeed? Four peer rates; no single "success rate". */
  success: {
    taskCount: number;
    acceptedTaskCount: number;
    acceptedOutputRate: number;
    firstAttemptAcceptedTaskCount: number;
    firstAttemptAcceptedRate: number;
    retryRecoveredTaskCount: number;
    retryRecoveryRate: number;
    terminalFailureTaskCount: number;
    terminalFailureRate: number;
  };
  /** Q2 — Is it productive? */
  productivity: {
    attemptCount: number;
    acceptedTasksPerDay: number;
    averageAttemptsPerAcceptedTask: number | null;
    medianTimeToAcceptedMs: number | null;
    medianTurnsPerAttempt: number | null;
    medianToolCallsPerAttempt: number | null;
  };
  /** Q3 — Where does it struggle? */
  hurdles: {
    failedAttemptCount: number;
    timeoutAttemptCount: number;
    abortedAttemptCount: number;
    cancelledAttemptCount: number;
    retryAttemptCount: number;
    highFrictionAttemptCount: number;
    failedToolCallCount: number;
    failedToolCallRate: number;
  };
  /** Q4 — Is it leveraging knowledge? */
  knowledge: {
    knowledgeToolCallCount: number;
    entrySearchCount: number;
    entryGetCount: number;
    packGetCount: number;
    knowledgeCallsPerAcceptedTask: number | null;
  };
  /** Q5 — ROI. No currency (see #1412); value-per-resource ratios only. */
  roi: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    acceptedTasksPerThousandTokens: number | null;
    tokensPerAcceptedTask: number | null;
    extraAttemptCount: number;
    extraTokensBeforeAcceptance: number;
  };
  /** Auditable raw counters behind the ratios. */
  raw: {
    messageCount: number;
    turnCount: number;
    toolCallCount: number;
    failedToolCallCount: number;
  };
}

/** One cohort row when `groupBy !== 'none'`. */
export interface TaskActivityAnalyticsGroup {
  key: string;
  label: string;
  metrics: TaskActivityProductMetrics;
}

/** The full analytics response. Mirrors the API's `TaskActivityAnalyticsResponse`. */
export interface TaskActivityAnalyticsResponse {
  range: { completedAfter: string; completedBefore: string };
  /**
   * false → the materialized stats table has not caught up to every attempt in
   * the window, so counts may undercount. The UI surfaces a non-blocking banner.
   */
  statsComplete: boolean;
  overall: TaskActivityProductMetrics;
  groups: TaskActivityAnalyticsGroup[];
}

/** UI load state for every analytics surface. */
export type AnalyticsStatus = 'loading' | 'error' | 'empty' | 'ready';

/**
 * Option lists a host supplies so the filter control can render pickers without
 * fetching. Each is a list of `{ value, label }`; omit any the host can't
 * provide and the filter hides that picker.
 */
export interface AnalyticsFilterOption {
  value: string;
  label: string;
}

export interface AnalyticsFilterOptions {
  tags?: AnalyticsFilterOption[];
  taskTypes?: AnalyticsFilterOption[];
  profiles?: AnalyticsFilterOption[];
  diaries?: AnalyticsFilterOption[];
  agents?: AnalyticsFilterOption[];
}
