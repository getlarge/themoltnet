import type { TaskListResponse, TaskStatus } from '@moltnet/api-client';
import { TaskQueueTable } from '@moltnet/task-ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, Card, Stack, Text, useTheme } from '@themoltnet/design-system';
import { type ChangeEvent, useMemo, useState } from 'react';
import { useLocation, useSearch } from 'wouter';

import { fetchTasks } from '../tasks/api.js';
import { getTaskStatusQuery, TASK_STATUS_FILTERS } from '../tasks/status.js';
import { useTeam } from '../team/useTeam.js';

const PAGE_SIZE = 30;

export function TasksPage() {
  const theme = useTheme();
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const { error: teamError, refreshTeams, selectedTeam } = useTeam();
  const [taskType, setTaskType] = useState(params.get('task_type') ?? '');
  const [correlationId, setCorrelationId] = useState(
    params.get('correlation_id') ?? '',
  );
  const status = getTaskStatusQuery(params.get('status'));
  const teamId = selectedTeam?.id;

  const enabled = Boolean(teamId);
  const query = useInfiniteQuery<TaskListResponse>({
    enabled,
    queryKey: [
      'tasks',
      'list',
      selectedTeam?.id ?? null,
      status ?? null,
      taskType.trim() || null,
      correlationId.trim() || null,
    ],
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    queryFn: ({ pageParam }) =>
      fetchTasks({
        teamId: teamId ?? '',
        status,
        taskType: taskType.trim(),
        correlationId: correlationId.trim(),
        cursor: pageParam as string | undefined,
        limit: PAGE_SIZE,
      }),
    refetchInterval: (query) => {
      const hasActive = query.state.data?.pages.some((page) =>
        page.items.some((task) =>
          ['queued', 'dispatched', 'running'].includes(task.status),
        ),
      );
      return hasActive ? 5_000 : false;
    },
  });
  const tasks = query.data?.pages.flatMap((page) => page.items) ?? [];

  function setStatus(next: TaskStatus | undefined) {
    const nextParams = new URLSearchParams(params);
    if (next) nextParams.set('status', next);
    else nextParams.delete('status');
    navigate(`/tasks?${nextParams.toString()}`);
  }

  return (
    <Stack gap={6}>
      <Stack
        direction="row"
        align="center"
        justify="space-between"
        gap={4}
        wrap
      >
        <Stack gap={1}>
          <Text variant="h2">Tasks</Text>
          <Text color="muted">
            Track queued, running, failed, and completed work in the active
            team.
          </Text>
        </Stack>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void query.refetch()}
          disabled={!enabled || query.isFetching}
        >
          Refresh
        </Button>
      </Stack>

      <Card variant="surface" padding="md">
        <Stack gap={4}>
          <Stack direction="row" gap={2} wrap>
            <FilterButton active={!status} onClick={() => setStatus(undefined)}>
              All
            </FilterButton>
            {TASK_STATUS_FILTERS.map((candidate) => (
              <FilterButton
                key={candidate}
                active={status === candidate}
                onClick={() => setStatus(candidate)}
              >
                {candidate}
              </FilterButton>
            ))}
          </Stack>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: theme.spacing[3],
            }}
          >
            <input
              aria-label="Task type"
              placeholder="task_type"
              value={taskType}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setTaskType(event.target.value)
              }
              style={inputStyle(theme)}
            />
            <input
              aria-label="Correlation ID"
              placeholder="correlation_id"
              value={correlationId}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setCorrelationId(event.target.value)
              }
              style={inputStyle(theme)}
            />
          </div>
        </Stack>
      </Card>

      {teamError ? (
        <Card style={{ padding: '1.5rem' }}>
          <Stack gap={3}>
            <Text variant="h4">Team scope unavailable</Text>
            <Text color="muted">
              Tasks require an active team scope. Check API connectivity and
              retry team loading.
            </Text>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refreshTeams()}
            >
              Retry team load
            </Button>
          </Stack>
        </Card>
      ) : !enabled ? (
        <Text color="muted">Select a team to view tasks.</Text>
      ) : query.isLoading ? (
        <Text color="muted">Loading tasks…</Text>
      ) : query.error ? (
        <Card style={{ padding: '1.5rem' }}>
          <Stack gap={3}>
            <Text color="muted">Failed to load tasks.</Text>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void query.refetch()}
            >
              Retry
            </Button>
          </Stack>
        </Card>
      ) : (
        <Stack gap={3}>
          <TaskQueueTable
            tasks={tasks}
            onOpenTask={(task) => navigate(`/tasks/${task.id}`)}
          />
          {query.hasNextPage ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          ) : null}
        </Stack>
      )}
    </Stack>
  );
}

function inputStyle(theme: ReturnType<typeof useTheme>): React.CSSProperties {
  return {
    padding: `${theme.spacing[3]} ${theme.spacing[4]}`,
    borderRadius: theme.radius.md,
    border: `1px solid ${theme.color.border.DEFAULT}`,
    background: theme.color.bg.surface,
    color: theme.color.text.DEFAULT,
    fontFamily: theme.font.family.sans,
    fontSize: theme.font.size.sm,
  };
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant={active ? 'primary' : 'secondary'}
      size="sm"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
