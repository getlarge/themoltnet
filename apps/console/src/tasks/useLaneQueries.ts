import { listTasksInfiniteOptions } from '@moltnet/api-client/query';
import {
  TASK_LANES,
  type TaskLaneData,
  type TaskLaneId,
} from '@moltnet/task-ui';
import { useInfiniteQuery } from '@tanstack/react-query';

import { getApiClient } from '../api.js';

const LANE_PAGE_SIZE = 20;

interface LaneFilters {
  teamId: string | undefined;
  query?: string;
  taskTypes?: string[];
  correlationId?: string;
  enabled: boolean;
}

/**
 * One infinite query per lane, server-filtered by the lane's statuses (via the
 * `statuses[]` param). Returns the per-lane data the board consumes plus real
 * per-lane totals for the funnel. `TASK_LANES` is a constant, so the fixed set
 * of hooks satisfies the rules of hooks.
 */
export function useLaneQueries(filters: LaneFilters): {
  lanes: Record<TaskLaneId, TaskLaneData>;
  counts: Record<TaskLaneId, number>;
  refetchAll: () => void;
} {
  const {
    teamId,
    query: taskQuery,
    taskTypes,
    correlationId,
    enabled,
  } = filters;

  // Active lanes (pending/active) keep polling so claims/transitions surface.
  // TASK_LANES is a stable constant, so this fixed-length map calls the same
  // hooks in the same order every render — the rules of hooks are satisfied.
  const laneResults = TASK_LANES.map((lane) => {
    const isActiveLane = lane.id === 'pending' || lane.id === 'active';
    const query = useInfiniteQuery({
      ...listTasksInfiniteOptions({
        client: getApiClient(),
        headers: { 'x-moltnet-team-id': teamId ?? '' },
        query: {
          query: taskQuery?.trim() || undefined,
          statuses: lane.statuses,
          taskTypes: taskTypes && taskTypes.length ? taskTypes : undefined,
          correlationId: correlationId?.trim() || undefined,
          limit: LANE_PAGE_SIZE,
        },
      }),
      enabled: enabled && Boolean(teamId),
      initialPageParam: {
        headers: { 'x-moltnet-team-id': teamId ?? '' },
        query: {},
      },
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      refetchInterval: isActiveLane ? 5_000 : false,
    });
    return { lane, query };
  });

  const lanes = {} as Record<TaskLaneId, TaskLaneData>;
  const counts = {} as Record<TaskLaneId, number>;
  for (const { lane, query } of laneResults) {
    const tasks = query.data?.pages.flatMap((page) => page.items) ?? [];
    // `total` is the real server count (same on every page); take the first.
    const total = query.data?.pages[0]?.total ?? tasks.length;
    lanes[lane.id] = {
      tasks,
      total,
      hasMore: query.hasNextPage,
      isLoading: query.isFetchingNextPage,
      onLoadMore: () => void query.fetchNextPage(),
    };
    counts[lane.id] = total;
  }

  const refetchAll = () => {
    for (const { query } of laneResults) void query.refetch();
  };

  return { lanes, counts, refetchAll };
}
