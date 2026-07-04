import { getTaskActivityAnalyticsOptions } from '@moltnet/api-client/query';
import {
  AnalyticsBoard,
  type AnalyticsFiltersValue,
  type AnalyticsStatus,
  type TaskActivityAnalyticsGroup,
} from '@moltnet/task-ui';
import { useQuery } from '@tanstack/react-query';
import { Stack, Text } from '@themoltnet/design-system';
import { useState } from 'react';
import { useLocation } from 'wouter';

import { getApiClient } from '../api.js';
import { useTeam } from '../team/useTeam.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Default to the trailing 30 days so recent completions are in view. */
function defaultFilters(): AnalyticsFiltersValue {
  const now = Date.now();
  return {
    completedAfter: new Date(now - THIRTY_DAYS_MS).toISOString(),
    completedBefore: new Date(now).toISOString(),
    groupBy: 'none',
  };
}

/**
 * Console analytics page. Owns filter state and fetches the activity analytics
 * for the selected team, then hands the response into the shared
 * <AnalyticsBoard>. Data fetching is isolated to this one file.
 *
 * The generated `TaskActivityAnalyticsResponse` is structurally identical to the
 * board's expected shape, so it flows in with no adapter. TanStack Query's
 * status (`pending | error | success`) is mapped EXPLICITLY to the board's
 * states — "empty" is a data-shape decision (no tasks in the window), not a
 * query status.
 */
export function TaskAnalyticsPage() {
  const [filters, setFilters] = useState<AnalyticsFiltersValue>(defaultFilters);
  const [, navigate] = useLocation();
  const { selectedTeam } = useTeam();
  const teamId = selectedTeam?.id;

  const query = useQuery({
    ...getTaskActivityAnalyticsOptions({
      client: getApiClient(),
      headers: { 'x-moltnet-team-id': teamId ?? '' },
      query: filters,
    }),
    enabled: Boolean(teamId),
  });

  const status: AnalyticsStatus = !teamId
    ? 'empty'
    : query.isPending
      ? 'loading'
      : query.isError
        ? 'error'
        : (query.data?.overall.success.taskCount ?? 0) === 0
          ? 'empty'
          : 'ready';

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
        status={status}
        response={query.data}
        error={query.error instanceof Error ? query.error.message : null}
        filters={filters}
        onFiltersChange={setFilters}
        onRetry={() => query.refetch()}
        onSelectGroup={onSelectGroup}
      />
    </Stack>
  );
}
