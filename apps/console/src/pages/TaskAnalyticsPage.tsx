import {
  AnalyticsBoard,
  type AnalyticsFiltersValue,
  type TaskActivityAnalyticsGroup,
} from '@moltnet/task-ui';
import { Stack, Text } from '@themoltnet/design-system';
import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';

import { getMockAnalytics } from '../analytics/mockAnalytics.js';

const DEFAULT_FILTERS: AnalyticsFiltersValue = {
  completedAfter: '2026-06-01T00:00:00.000Z',
  completedBefore: '2026-07-01T00:00:00.000Z',
  groupBy: 'none',
};

/**
 * Console analytics page. Owns filter state and produces the analytics response
 * through a data adapter, then hands both into the shared <AnalyticsBoard>.
 *
 * Data fetching is isolated to this one file. Today it calls the mock adapter;
 * when the analytics endpoint ships (see #1373 / PR #1550), replace
 * `getMockAnalytics` with the generated react-query option and map its states
 * to the board's `status` EXPLICITLY — TanStack Query's status is
 * `pending | error | success`, not the board's `loading | error | empty | ready`,
 * and "empty" is a data-shape decision (no attempts in the window), not a query
 * status. For example:
 *
 *   const query = useQuery(getTaskActivityAnalyticsOptions({ query: filters }));
 *   const status: AnalyticsStatus =
 *     query.isPending ? 'loading'
 *     : query.isError ? 'error'
 *     : (query.data?.overall.success.taskCount ?? 0) === 0 ? 'empty'
 *     : 'ready';
 *   // <AnalyticsBoard status={status} response={query.data} onRetry={query.refetch} ... />
 */
export function TaskAnalyticsPage() {
  const [filters, setFilters] = useState<AnalyticsFiltersValue>(DEFAULT_FILTERS);
  const [, navigate] = useLocation();

  const response = useMemo(() => getMockAnalytics(filters), [filters]);

  // Drilldown is only meaningful for dimensions the task list can filter on.
  // Today that's the agent cohort; other groupings have no drilldown target yet,
  // so we don't pass a handler for them (keeping rows non-interactive rather than
  // clickable-but-inert).
  const onSelectGroup =
    filters.groupBy === 'agent'
      ? (group: TaskActivityAnalyticsGroup) =>
          navigate(`/tasks?claimedByAgentId=${encodeURIComponent(group.key)}`)
      : undefined;

  return (
    <Stack gap={6}>
      <Stack gap={1}>
        <Text variant="h2">Task analytics</Text>
        <Text color="muted">
          Agent reliability, productivity, hurdles, knowledge leverage and
          token-efficiency across your tasks.
        </Text>
      </Stack>

      <AnalyticsBoard
        status="ready"
        response={response}
        filters={filters}
        onFiltersChange={setFilters}
        onSelectGroup={onSelectGroup}
      />
    </Stack>
  );
}
