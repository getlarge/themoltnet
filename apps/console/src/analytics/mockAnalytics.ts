// Mock analytics adapter.
//
// This stands in for the real endpoint (`GET /tasks/analytics/activity`, being
// built on the `codex/agent-roi-analytics` branch). It returns the exact wire
// shape the UI consumes, so when the API merges the only change here is swapping
// this function for the generated `@moltnet/api-client/query` option — see the
// TODO in TaskAnalyticsPage.
//
// TODO(#1373): replace with `getTaskActivityAnalyticsOptions` from
// `@moltnet/api-client/query` once the analytics endpoint ships.

import {
  type AnalyticsFiltersValue,
  makeMetrics,
  makeResponse,
  type TaskActivityAnalyticsGroup,
  type TaskActivityAnalyticsResponse,
  type TaskActivityProductMetrics,
} from '@moltnet/task-ui';

/** Deterministic pseudo-random in [0, 1) from a string seed (no Math.random). */
function seededUnit(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000) / 1000;
}

function scaleMetrics(
  base: TaskActivityProductMetrics,
  factor: number,
): TaskActivityProductMetrics {
  const clampRate = (r: number) => Math.min(1, Math.max(0, r * factor));
  return {
    ...base,
    success: {
      ...base.success,
      acceptedOutputRate: clampRate(base.success.acceptedOutputRate),
      firstAttemptAcceptedRate: clampRate(base.success.firstAttemptAcceptedRate),
    },
  };
}

const DAY_LABELS = [
  'Jun 24',
  'Jun 25',
  'Jun 26',
  'Jun 27',
  'Jun 28',
  'Jun 29',
  'Jun 30',
];

function buildGroups(
  filters: AnalyticsFiltersValue,
): TaskActivityAnalyticsGroup[] {
  const groupBy = filters.groupBy ?? 'none';
  if (groupBy === 'none') return [];

  if (groupBy === 'day') {
    return DAY_LABELS.map((label, i) => {
      const factor = 0.7 + seededUnit(`day-${label}`) * 0.5;
      return {
        key: `2026-06-${24 + i}`,
        label,
        metrics: scaleMetrics(makeMetrics(), factor),
      };
    });
  }

  const cohorts: Record<string, string[]> = {
    providerModel: ['anthropic/opus-4.8', 'anthropic/sonnet-5', 'openai/gpt-5'],
    tag: ['ui', 'backend', 'docs', 'infra'],
    taskType: ['fulfill_brief', 'assess_brief', 'freeform'],
    profile: ['profile-fast', 'profile-thorough'],
    diary: ['themoltnet', 'nestjs-tools'],
    agent: ['legreffier', 'traffic-fit-auditor'],
  };
  const labels = cohorts[groupBy] ?? ['cohort-a', 'cohort-b'];
  return labels.map((label) => {
    const factor = 0.6 + seededUnit(`${groupBy}-${label}`) * 0.7;
    return {
      key: label,
      label,
      metrics: scaleMetrics(makeMetrics(), factor),
    };
  });
}

/**
 * Returns a mock analytics response shaped exactly like the real API. The
 * numbers wobble deterministically with the filters so the UI feels live
 * (changing the date range / grouping visibly changes the board).
 */
export function getMockAnalytics(
  filters: AnalyticsFiltersValue,
): TaskActivityAnalyticsResponse {
  // Vary the aggregate slightly by the active cohort filters so the surface
  // reacts to filtering.
  const cohortSeed = [
    ...(filters.tags ?? []),
    ...(filters.taskTypes ?? []),
    ...(filters.profileIds ?? []),
    ...(filters.diaryIds ?? []),
    ...(filters.claimedByAgentIds ?? []),
  ].join(',');
  const factor = cohortSeed ? 0.75 + seededUnit(cohortSeed) * 0.4 : 1;

  return makeResponse({
    range: {
      completedAfter: filters.completedAfter ?? '2026-06-01T00:00:00.000Z',
      completedBefore: filters.completedBefore ?? '2026-07-01T00:00:00.000Z',
    },
    overall: scaleMetrics(makeMetrics(), factor),
    groups: buildGroups(filters),
  });
}
