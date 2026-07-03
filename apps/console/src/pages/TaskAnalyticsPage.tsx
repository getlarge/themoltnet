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
 * when the analytics endpoint ships (see #1373 / codex/agent-roi-analytics),
 * replace `getMockAnalytics` with the generated react-query option:
 *
 *   const { data, status, refetch } = useQuery(
 *     getTaskActivityAnalyticsOptions({ query: filters }),
 *   );
 *
 * The board props map 1:1 to that query's states, so nothing else changes.
 */
export function TaskAnalyticsPage() {
  const [filters, setFilters] = useState<AnalyticsFiltersValue>(DEFAULT_FILTERS);
  const [, navigate] = useLocation();

  const response = useMemo(() => getMockAnalytics(filters), [filters]);

  function onGroupClick(group: TaskActivityAnalyticsGroup) {
    // Drilldown placeholder: a real implementation could push the cohort into
    // the task list filter. For now, log the intent via navigation to tasks.
    if (filters.groupBy === 'agent') {
      navigate(`/tasks?claimedByAgentId=${encodeURIComponent(group.key)}`);
    }
  }

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
        onGroupClick={onGroupClick}
      />
    </Stack>
  );
}
