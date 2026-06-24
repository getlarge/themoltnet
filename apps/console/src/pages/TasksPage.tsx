import {
  batchDeleteTasks,
  createTask,
  type TaskStatus,
} from '@moltnet/api-client';
import {
  getTaskOptions,
  listRuntimeProfilesOptions,
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
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Button,
  Card,
  Dialog,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useLocation, useSearch } from 'wouter';

import { getApiClient } from '../api.js';
import { getConfig } from '../config.js';
import { useDiarySummaries } from '../diaries/hooks.js';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { getTaskStatusQuery, TASK_STATUS_FILTERS } from '../tasks/status.js';
import { useLaneQueries } from '../tasks/useLaneQueries.js';
import { useTeam } from '../team/useTeam.js';

const PAGE_SIZE = 30;

/** Docs page explaining how to install and run an agent daemon. */
const AGENT_DAEMON_DOCS_HREF = `${getConfig().docsUrl}/use/agent-daemon`;
const SUCCESS_CRITERIA_DOCS_HREF = `${getConfig().docsUrl}/use/agent-executors#self-verification-producer-llm-evaluates-its-own-output`;

export function TasksPage() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const { error: teamError, refreshTeams, selectedTeam } = useTeam();
  const [taskTypes, setTaskTypes] = useState<string[]>(() => {
    const raw = params.get('task_type');
    return raw ? raw.split(',') : [];
  });
  const [taskQuery, setTaskQuery] = useState(params.get('query') ?? '');
  const [correlationId, setCorrelationId] = useState(
    params.get('correlation_id') ?? '',
  );
  const status = getTaskStatusQuery(params.get('status'));
  const [view, setView] = useState<'board' | 'table'>('board');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteMode, setDeleteMode] = useState<'safe' | 'accept-risk'>('safe');
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteResult, setDeleteResult] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const isMobile = useIsMobile();
  const teamId = selectedTeam?.id;

  // Debounce the free-text filters before they feed TanStack query keys. The
  // inputs stay bound to the raw state (typing feels instant), but queries only
  // re-run once typing settles — one request per pause instead of one per
  // keystroke across the table + every board lane. See issue #1320.
  const debouncedTaskQuery = useDebouncedValue(taskQuery, 250);
  const debouncedCorrelationId = useDebouncedValue(correlationId, 250);
  const taskScopeKey = [
    teamId ?? '',
    view,
    status ?? '',
    taskTypes.join(','),
    debouncedTaskQuery.trim(),
    debouncedCorrelationId.trim(),
  ].join('|');

  useEffect(() => {
    setSelectedTaskIds(new Set());
    setConfirmDeleteOpen(false);
    setDeleteMode('safe');
    setDeleteReason('');
    setDeleteError(null);
    setDeleteResult(null);
  }, [taskScopeKey]);

  const diariesQuery = useDiarySummaries(teamId ?? null);
  const diaryOptions = useMemo(
    () => (diariesQuery.data ?? []).map((d) => ({ id: d.id, name: d.name })),
    [diariesQuery.data],
  );

  const enabled = Boolean(teamId);
  // The shared infinite query backs the table view only. Board mode runs its own
  // per-lane queries (useLaneQueries), so keeping this query hot during board
  // mode just duplicated every lane's load against the global rate limiter.
  // Gate it on the table view so it idles while the board is shown (#1320).
  const query = useInfiniteQuery({
    ...listTasksInfiniteOptions({
      client: getApiClient(),
      headers: { 'x-moltnet-team-id': teamId ?? '' },
      query: {
        query: debouncedTaskQuery.trim() || undefined,
        status,
        taskTypes: taskTypes.length ? taskTypes : undefined,
        correlationId: debouncedCorrelationId.trim() || undefined,
        limit: PAGE_SIZE,
      },
    }),
    enabled: enabled && view === 'table',
    initialPageParam: {
      headers: { 'x-moltnet-team-id': teamId ?? '' },
      query: {},
    },
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
    query: debouncedTaskQuery,
    taskTypes,
    correlationId: debouncedCorrelationId,
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

  const runtimeProfilesQuery = useQuery({
    ...listRuntimeProfilesOptions({
      client: getApiClient(),
      headers: { 'x-moltnet-team-id': teamId ?? '' },
    }),
    enabled,
  });
  const runtimeProfileOptions = useMemo(
    () =>
      (runtimeProfilesQuery.data?.items ?? []).map((profile) => ({
        id: profile.id,
        name: profile.name,
        provider: profile.provider,
        model: profile.model,
      })),
    [runtimeProfilesQuery.data],
  );

  // Dedicated candidate set for the depends-on picker — scoped to selectable
  // prerequisite statuses (non-terminal + completed), independent of the
  // board's display filter. Only fetched while the create dialog is open so it
  // does not contribute to the request budget on every Tasks page load (#1320).
  const candidateQuery = useQuery({
    ...listTasksOptions({
      client: getApiClient(),
      headers: { 'x-moltnet-team-id': teamId ?? '' },
      query: {
        statuses: ['waiting', 'queued', 'dispatched', 'running', 'completed'],
        limit: 50,
      },
    }),
    enabled: enabled && showCreate,
  });
  const pickerCandidates = candidateQuery.data?.items ?? [];
  const searchPickerCandidates = useCallback(
    async (searchText: string) => {
      if (!teamId) return [];
      const data = await queryClient.fetchQuery(
        listTasksOptions({
          client: getApiClient(),
          headers: { 'x-moltnet-team-id': teamId },
          query: {
            query: searchText.trim() || undefined,
            statuses: [
              'waiting',
              'queued',
              'dispatched',
              'running',
              'completed',
            ],
            limit: 20,
          },
        }),
      );
      return data.items;
    },
    [queryClient, teamId],
  );

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

  function toggleTaskSelection(id: string, selected: boolean) {
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleVisibleTaskSelection(selected: boolean) {
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      for (const task of tasks) {
        if (selected) next.add(task.id);
        else next.delete(task.id);
      }
      return next;
    });
  }

  async function submitDeleteTasks() {
    const ids = [...selectedTaskIds];
    if (ids.length === 0) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const { data, error: apiError } = await batchDeleteTasks({
        client: getApiClient(),
        body: {
          ids,
          mode: deleteMode,
          ...(deleteMode === 'accept-risk'
            ? { reason: deleteReason.trim() }
            : {}),
        },
      });
      if (apiError || !data) {
        throw new Error('Failed to delete selected tasks');
      }
      setSelectedTaskIds(new Set());
      setConfirmDeleteOpen(false);
      setDeleteMode('safe');
      setDeleteReason('');
      setDeleteResult(
        `${data.deleted.length} deleted, ${data.skipped.length} skipped`,
      );
      if (view === 'board') refetchLanes();
      else void query.refetch();
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : 'Failed to delete tasks',
      );
    } finally {
      setIsDeleting(false);
    }
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
        <div
          aria-label="Task actions"
          style={{
            display: 'flex',
            gap: theme.spacing[2],
            flexWrap: 'wrap',
          }}
        >
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
          {view === 'table' ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={selectedTaskIds.size === 0}
              onClick={() => {
                setDeleteResult(null);
                setDeleteError(null);
                setConfirmDeleteOpen(true);
              }}
            >
              Delete selected
            </Button>
          ) : null}
          <Button
            variant={view === 'board' ? 'primary' : 'secondary'}
            size="sm"
            aria-pressed={view === 'board'}
            onClick={() => setView('board')}
          >
            Board
          </Button>
          <Button
            variant={view === 'table' ? 'primary' : 'secondary'}
            size="sm"
            aria-pressed={view === 'table'}
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
        </div>
      </Stack>

      {deleteResult ? <Text color="muted">{deleteResult}</Text> : null}

      <Card variant="surface" padding="md">
        <Stack gap={4}>
          <div
            aria-label="Filter tasks by status"
            style={{
              display: 'flex',
              gap: theme.spacing[2],
              flexWrap: 'wrap',
            }}
          >
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
          </div>

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
              aria-label="Search tasks"
              placeholder="Search title, tags, input, id"
              value={taskQuery}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setTaskQuery(event.target.value)
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
              selectedTaskIds={selectedTaskIds}
              onToggleTask={(task, selected) =>
                toggleTaskSelection(task.id, selected)
              }
              onToggleVisible={toggleVisibleTaskSelection}
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
          runtimeProfiles={runtimeProfileOptions}
          onSearchCandidates={searchPickerCandidates}
          successCriteriaDocsHref={SUCCESS_CRITERIA_DOCS_HREF}
          onClose={() => setShowCreate(false)}
          onSubmit={async (request: CreateTaskRequest) => {
            const { teamId: requestTeamId, ...body } = request;
            const { data, error: apiError } = await createTask({
              client: getApiClient(),
              headers: { 'x-moltnet-team-id': requestTeamId },
              body,
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
            // Refresh whichever view is showing. In board mode the table query
            // is disabled, so refetching it would be a no-op (and silently fail
            // to surface the new task) — refetch the lanes instead (#1320).
            if (view === 'board') refetchLanes();
            else void query.refetch();
          }}
        />
      ) : null}

      <Dialog
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        title="Delete selected tasks"
        width="460px"
      >
        <Stack gap={4}>
          <Text>
            Delete {selectedTaskIds.size} selected task
            {selectedTaskIds.size === 1 ? '' : 's'}? Safe mode skips live,
            unauthorized, missing, and protected tasks.
          </Text>
          <label style={{ display: 'flex', gap: theme.spacing[2] }}>
            <input
              type="checkbox"
              checked={deleteMode === 'accept-risk'}
              onChange={(event) =>
                setDeleteMode(event.target.checked ? 'accept-risk' : 'safe')
              }
            />
            <span>Use accept-risk mode for terminal protected tasks</span>
          </label>
          {deleteMode === 'accept-risk' ? (
            <textarea
              aria-label="Task deletion reason"
              placeholder="Reason"
              value={deleteReason}
              onChange={(event) => setDeleteReason(event.target.value)}
              style={{ ...inputStyle(theme), minHeight: 88 }}
            />
          ) : null}
          {deleteError ? <Text color="error">{deleteError}</Text> : null}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: theme.spacing[2],
            }}
          >
            <Button
              variant="secondary"
              onClick={() => setConfirmDeleteOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="accent"
              onClick={() => void submitDeleteTasks()}
              disabled={
                isDeleting ||
                selectedTaskIds.size === 0 ||
                (deleteMode === 'accept-risk' && deleteReason.trim() === '')
              }
            >
              {isDeleting ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </Stack>
      </Dialog>
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
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
