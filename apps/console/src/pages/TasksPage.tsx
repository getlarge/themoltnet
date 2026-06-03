import { createTask, type TaskStatus } from '@moltnet/api-client';
import {
  getTaskOptions,
  listTaskAttemptsOptions,
  listTaskMessagesOptions,
  listTaskSchemasOptions,
  listTasksInfiniteOptions,
  listTasksOptions,
} from '@moltnet/api-client/query';
import {
  CreateTaskDialog,
  type CreateTaskRequest,
  isTaskNonTerminal,
  TaskFunnelStrip,
  TaskLaneBoard,
  TaskLivePane,
  TaskQueueTable,
  TaskTypeFacet,
} from '@moltnet/task-ui';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Button, Card, Stack, Text, useTheme } from '@themoltnet/design-system';
import { type ChangeEvent, useMemo, useState } from 'react';
import { useLocation, useSearch } from 'wouter';

import { getApiClient } from '../api.js';
import { getConfig } from '../config.js';
import { useDiarySummaries } from '../diaries/hooks.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { getTaskStatusQuery, TASK_STATUS_FILTERS } from '../tasks/status.js';
import { useLaneQueries } from '../tasks/useLaneQueries.js';
import { useTeam } from '../team/useTeam.js';

const PAGE_SIZE = 30;

/** Docs page explaining how to install and run an agent daemon. */
const AGENT_DAEMON_DOCS_HREF = `${getConfig().docsUrl}/use/agent-daemon`;

export function TasksPage() {
  const theme = useTheme();
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const { error: teamError, refreshTeams, selectedTeam } = useTeam();
  const [taskTypes, setTaskTypes] = useState<string[]>(() => {
    const raw = params.get('task_type');
    return raw ? raw.split(',') : [];
  });
  const [correlationId, setCorrelationId] = useState(
    params.get('correlation_id') ?? '',
  );
  const status = getTaskStatusQuery(params.get('status'));
  const [view, setView] = useState<'board' | 'table'>('board');
  const [showCreate, setShowCreate] = useState(false);
  const isMobile = useIsMobile();
  const teamId = selectedTeam?.id;

  const diariesQuery = useDiarySummaries(teamId ?? null);
  const diaryOptions = useMemo(
    () => (diariesQuery.data ?? []).map((d) => ({ id: d.id, name: d.name })),
    [diariesQuery.data],
  );

  const enabled = Boolean(teamId);
  const query = useInfiniteQuery({
    ...listTasksInfiniteOptions({
      client: getApiClient(),
      query: {
        teamId: teamId ?? '',
        status,
        taskTypes: taskTypes.length ? taskTypes : undefined,
        correlationId: correlationId.trim() || undefined,
        limit: PAGE_SIZE,
      },
    }),
    enabled,
    initialPageParam: { query: { teamId: teamId ?? '' } },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    refetchInterval: (query) => {
      const hasActive = query.state.data?.pages.some((page) =>
        page.items.some((task) =>
          ['waiting', 'queued', 'dispatched', 'running'].includes(task.status),
        ),
      );
      return hasActive ? 5_000 : false;
    },
  });
  const tasks = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  // Board view: one server-filtered query per lane with real per-lane totals,
  // so the board scales and the funnel counts are accurate (the single `query`
  // above still feeds the table view, Refresh, and the create dialog's
  // candidate list).
  const {
    lanes,
    counts: laneCounts,
    refetchAll: refetchLanes,
  } = useLaneQueries({
    teamId,
    taskTypes,
    correlationId,
    enabled: enabled && view === 'board',
  });

  // Registered task types (for the type facet + the depends-on picker filter).
  // Sourced from the API, not @moltnet/tasks, to keep server schemas out of the
  // browser bundle.
  const schemasQuery = useQuery({
    ...listTaskSchemasOptions({ client: getApiClient() }),
    enabled,
  });
  const registeredTaskTypes = useMemo(
    () => (schemasQuery.data?.items ?? []).map((d) => d.taskType),
    [schemasQuery.data],
  );

  // Dedicated candidate set for the depends-on picker — scoped to selectable
  // prerequisite statuses (non-terminal + completed), independent of the
  // board's display filter.
  const candidateQuery = useQuery({
    ...listTasksOptions({
      client: getApiClient(),
      query: {
        teamId: teamId ?? '',
        statuses: ['waiting', 'queued', 'dispatched', 'running', 'completed'],
        limit: 50,
      },
    }),
    enabled,
  });
  const pickerCandidates = candidateQuery.data?.items ?? [];

  function updateTaskTypes(next: string[]) {
    setTaskTypes(next);
    const nextParams = new URLSearchParams(params);
    if (next.length) nextParams.set('task_type', next.join(','));
    else nextParams.delete('task_type');
    navigate(`/tasks?${nextParams.toString()}`);
  }

  const selectedTaskId = params.get('selected') ?? undefined;

  function selectTask(id: string | undefined) {
    const next = new URLSearchParams(params);
    if (id) next.set('selected', id);
    else next.delete('selected');
    navigate(`/tasks?${next.toString()}`);
  }

  // A selected task keeps progressing through its lifecycle (waiting → queued →
  // dispatched → running → terminal). The pane must keep polling the task and
  // its attempts until the task reaches a terminal state — otherwise selecting
  // a pending task fetches an empty attempt list once and the live stream never
  // starts when an agent later claims it.
  const selectedTaskQuery = useQuery({
    ...getTaskOptions({
      client: getApiClient(),
      path: { id: selectedTaskId ?? '' },
    }),
    enabled: Boolean(selectedTaskId),
    refetchInterval: (q) =>
      q.state.data && isTaskNonTerminal(q.state.data.status) ? 3_000 : false,
  });
  const selectedTask = selectedTaskQuery.data ?? null;
  const selectedTaskActive = Boolean(
    selectedTask && isTaskNonTerminal(selectedTask.status),
  );
  const selectedAttemptsQuery = useQuery({
    ...listTaskAttemptsOptions({
      client: getApiClient(),
      path: { id: selectedTaskId ?? '' },
    }),
    enabled: Boolean(selectedTaskId),
    // Poll attempts while the task is non-terminal so a pending→active
    // transition surfaces the first attempt (and subsequent retries).
    refetchInterval: selectedTaskActive ? 3_000 : false,
  });
  const latestAttempt = selectedAttemptsQuery.data?.at(-1) ?? null;
  const selectedMessagesQuery = useQuery({
    ...listTaskMessagesOptions({
      client: getApiClient(),
      path: { id: selectedTaskId ?? '', n: latestAttempt?.attemptN ?? 0 },
      query: { limit: 200 },
    }),
    enabled: Boolean(selectedTaskId && latestAttempt),
    refetchInterval: (q) =>
      latestAttempt && ['claimed', 'running'].includes(latestAttempt.status)
        ? q.state.data
          ? 3_000
          : 1_000
        : false,
  });

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
            Track waiting, queued, running, failed, and completed work in the
            active team.
          </Text>
        </Stack>
        <Stack direction="row" gap={2}>
          <Button
            size="sm"
            onClick={() => setShowCreate(true)}
            disabled={!enabled || diaryOptions.length === 0}
            title={
              diaryOptions.length === 0
                ? 'Create a diary in this team first'
                : undefined
            }
          >
            New task
          </Button>
          <Button
            variant={view === 'board' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setView('board')}
          >
            Board
          </Button>
          <Button
            variant={view === 'table' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setView('table')}
          >
            Table
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (view === 'board') refetchLanes();
              else void query.refetch();
            }}
            disabled={!enabled}
          >
            Refresh
          </Button>
        </Stack>
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
            <TaskTypeFacet
              availableTypes={registeredTaskTypes}
              selected={taskTypes}
              onChange={updateTaskTypes}
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
      ) : // The board renders its own per-lane loading/empty states; only the
      // table view blocks on the shared query.
      view === 'table' && query.isLoading ? (
        <Text color="muted">Loading tasks…</Text>
      ) : view === 'table' && query.error ? (
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
        <Stack gap={4}>
          {view === 'board' ? (
            <>
              <TaskFunnelStrip counts={laneCounts} />
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile
                    ? 'minmax(0, 1fr)'
                    : selectedTaskId
                      ? 'minmax(0, 1fr) minmax(320px, 420px)'
                      : '1fr',
                  gap: theme.spacing[4],
                  alignItems: 'start',
                }}
              >
                <TaskLaneBoard
                  lanes={lanes}
                  selectedTaskId={selectedTaskId}
                  onSelectTask={(task) => selectTask(task.id)}
                />
                {selectedTaskId && selectedTask ? (
                  <TaskLivePane
                    task={selectedTask}
                    attempt={latestAttempt}
                    messages={selectedMessagesQuery.data ?? []}
                    learnMoreHref={AGENT_DAEMON_DOCS_HREF}
                    defaultCollapsed={isMobile}
                    onClose={() => selectTask(undefined)}
                  />
                ) : null}
              </div>
            </>
          ) : (
            <TaskQueueTable
              tasks={tasks}
              onOpenTask={(task) => navigate(`/tasks/${task.id}`)}
            />
          )}
          {/* Board paginates per-lane; the shared Load more is for the table. */}
          {view === 'table' && query.hasNextPage ? (
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

      {teamId ? (
        <CreateTaskDialog
          open={showCreate}
          teamId={teamId}
          diaries={diaryOptions}
          candidateTasks={pickerCandidates}
          availableTypes={registeredTaskTypes}
          onClose={() => setShowCreate(false)}
          onSubmit={async (request: CreateTaskRequest) => {
            const { data, error: apiError } = await createTask({
              client: getApiClient(),
              body: request,
            });
            if (apiError || !data || !('id' in data)) {
              const detail =
                apiError && typeof apiError === 'object' && 'detail' in apiError
                  ? String((apiError as { detail?: unknown }).detail)
                  : 'Failed to create task';
              throw new Error(detail);
            }
            return data.id;
          }}
          onCreated={() => {
            setShowCreate(false);
            void query.refetch();
          }}
        />
      ) : null}
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
