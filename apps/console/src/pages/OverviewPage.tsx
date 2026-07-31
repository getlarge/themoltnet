import {
  getTeamOptions,
  listAgentKeysOptions,
  listRuntimeProfilesOptions,
  listTasksOptions,
} from '@moltnet/api-client/query';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  ControlSurface,
  DescriptionList,
  EmptyState,
  InlineNotice,
  PageHeader,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import {
  ArrowRight,
  Bot,
  LibraryBig,
  ListTodo,
  ShieldCheck,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useLocation } from 'wouter';

import { getApiClient } from '../api.js';
import { useDiarySummaries } from '../diaries/hooks.js';
import { useTeam } from '../team/useTeam.js';

const TEAM_HEADER = 'x-moltnet-team-id';

export function OverviewPage() {
  const theme = useTheme();
  const [, navigate] = useLocation();
  const { error: teamError, isLoading: teamsLoading, selectedTeam } = useTeam();
  const teamId = selectedTeam?.id ?? '';
  const hasProjectTeam = Boolean(selectedTeam && !selectedTeam.personal);

  const tasksQuery = useQuery({
    ...listTasksOptions({
      client: getApiClient(),
      headers: { [TEAM_HEADER]: teamId },
      query: { limit: 50 },
    }),
    enabled: hasProjectTeam,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
  const profilesQuery = useQuery({
    ...listRuntimeProfilesOptions({
      client: getApiClient(),
      headers: { [TEAM_HEADER]: teamId },
    }),
    enabled: hasProjectTeam,
    staleTime: 30_000,
  });
  const keysQuery = useQuery({
    ...listAgentKeysOptions({
      client: getApiClient(),
      headers: { [TEAM_HEADER]: teamId },
      query: { limit: 50 },
    }),
    enabled: hasProjectTeam,
    staleTime: 30_000,
  });
  const teamQuery = useQuery({
    ...getTeamOptions({ client: getApiClient(), path: { id: teamId } }),
    enabled: hasProjectTeam,
    staleTime: 30_000,
  });
  const diariesQuery = useDiarySummaries(hasProjectTeam ? teamId : null);

  const tasks = tasksQuery.data?.items ?? [];
  const loadedTaskCount = tasks.length;
  const taskTotal = tasksQuery.data?.total ?? loadedTaskCount;
  const countsArePartial = taskTotal > loadedTaskCount;
  const activeTasks = tasks.filter((task) =>
    ['dispatched', 'running'].includes(task.status),
  );
  const waitingTasks = tasks.filter((task) => task.status === 'waiting');
  const failedTasks = tasks.filter((task) => task.status === 'failed');
  const attentionTasks = [...failedTasks, ...waitingTasks].slice(0, 6);

  const profiles = profilesQuery.data?.items ?? [];
  const enforcedProfiles = profiles.filter(
    (profile) => profile.toolEnforcement === 'enforce',
  ).length;
  const keys = keysQuery.data?.items ?? [];
  const activeKeys = keys.filter((key) => key.status === 'active').length;
  const keyCountIsPartial = Boolean(keysQuery.data?.nextCursor);

  const diaries = diariesQuery.data ?? [];
  const retainedEntries = diaries.reduce(
    (total, diary) => total + diary.entryCount,
    0,
  );
  const agentMembers = (teamQuery.data?.members ?? []).filter(
    (member) => member.subjectType.toLowerCase() === 'agent',
  ).length;

  return (
    <Stack gap={8}>
      <PageHeader
        eyebrow="Control plane"
        title="Operations"
        description={
          selectedTeam
            ? `Monitor work, runtime authority, and retained knowledge for ${selectedTeam.name}.`
            : 'Monitor work, runtime authority, and retained knowledge from one place.'
        }
        actions={
          <Stack direction="row" gap={2} wrap>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate('/tasks')}
            >
              Task board
            </Button>
            <Button
              size="sm"
              disabled={!hasProjectTeam || diaries.length === 0}
              onClick={() => navigate('/tasks?create=1')}
            >
              New task
            </Button>
          </Stack>
        }
      />

      {teamsLoading ? (
        <ControlSurface as="section" padding="md">
          <Text color="muted">Loading team scope…</Text>
        </ControlSurface>
      ) : teamError ? (
        <InlineNotice tone="error" title="Team scope unavailable">
          The console could not load the selected team. Open Teams to restore
          the operator scope before making changes.
        </InlineNotice>
      ) : !hasProjectTeam && !teamsLoading ? (
        <EmptyState
          icon={<Bot size={22} strokeWidth={1.7} />}
          title="Select a project team"
          description="Operational data is team-scoped. Personal workspaces do not expose the shared task, runtime, and knowledge control plane."
          action={
            <Button size="sm" onClick={() => navigate('/teams')}>
              Open teams
            </Button>
          }
        />
      ) : hasProjectTeam ? (
        <>
          <section aria-labelledby="systems-heading">
            <Stack gap={4}>
              <Stack gap={1}>
                <Text id="systems-heading" variant="h2">
                  Three systems. One operating model.
                </Text>
                <Text color="secondary">
                  Work moves through the task engine, executes inside explicit
                  runtime authority, and can leave attributable knowledge
                  behind.
                </Text>
              </Stack>
              <div
                style={{
                  display: 'grid',
                  gap: theme.spacing[4],
                  gridTemplateColumns:
                    'repeat(auto-fit, minmax(min(100%, 19rem), 1fr))',
                }}
              >
                <SystemPanel
                  icon={<ListTodo size={21} strokeWidth={1.8} />}
                  eyebrow="Task Engine"
                  title="Coordinate durable work"
                  description="Contracts, claim conditions, attempts, outputs, and review remain inspectable as one lifecycle."
                  status={queryStatus(tasksQuery)}
                  metrics={[
                    {
                      label: 'Team total',
                      value: valueOrDash(taskTotal, tasksQuery),
                    },
                    {
                      label: countsArePartial
                        ? 'Active · loaded page'
                        : 'Active',
                      value: valueOrDash(activeTasks.length, tasksQuery),
                    },
                    {
                      label: countsArePartial
                        ? 'Waiting · loaded page'
                        : 'Waiting',
                      value: valueOrDash(waitingTasks.length, tasksQuery),
                    },
                  ]}
                  actionLabel="Open task board"
                  onAction={() => navigate('/tasks')}
                />
                <SystemPanel
                  icon={<ShieldCheck size={21} strokeWidth={1.8} />}
                  eyebrow="Agent Runtime"
                  title="Bound execution authority"
                  description="Profiles, tool policies, and agent keys define what may run and what each agent can reach."
                  status={mergeQueryStatus(profilesQuery, keysQuery)}
                  metrics={[
                    {
                      label: 'Runtime profiles',
                      value: valueOrDash(profiles.length, profilesQuery),
                    },
                    {
                      label: 'Enforced policies',
                      value: valueOrDash(enforcedProfiles, profilesQuery),
                    },
                    {
                      label: keyCountIsPartial
                        ? 'Active keys · first 50'
                        : 'Active keys',
                      value: valueOrDash(activeKeys, keysQuery),
                    },
                  ]}
                  actionLabel="Inspect runtime"
                  onAction={() => navigate('/runtime/profiles')}
                />
                <SystemPanel
                  icon={<LibraryBig size={21} strokeWidth={1.8} />}
                  eyebrow="Knowledge Factory"
                  title="Retain accountable context"
                  description="Signed diary entries become attributable, searchable material for future agents and evaluations."
                  status={queryStatus(diariesQuery)}
                  metrics={[
                    {
                      label: 'Diaries',
                      value: valueOrDash(diaries.length, diariesQuery),
                    },
                    {
                      label: 'Retained entries',
                      value: valueOrDash(retainedEntries, diariesQuery),
                    },
                    {
                      label: 'Task-linked',
                      value: tasksQuery.isError ? '—' : 'Per execution record',
                    },
                  ]}
                  actionLabel="Open diaries"
                  onAction={() => navigate('/diaries')}
                />
              </div>
            </Stack>
          </section>

          <div
            style={{
              alignItems: 'start',
              display: 'grid',
              gap: theme.spacing[5],
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 24rem), 1fr))',
            }}
          >
            <ControlSurface as="section" padding="md">
              <Stack gap={4}>
                <Stack direction="row" justify="space-between" align="center">
                  <Stack gap={1}>
                    <Text variant="overline" color="primary">
                      Task Engine
                    </Text>
                    <Text variant="h3">Requires attention</Text>
                  </Stack>
                  <Badge
                    variant={attentionTasks.length ? 'warning' : 'success'}
                  >
                    {tasksQuery.isError
                      ? 'Unavailable'
                      : tasksQuery.isLoading
                        ? 'Loading'
                        : `${attentionTasks.length} loaded`}
                  </Badge>
                </Stack>
                {tasksQuery.isError ? (
                  <InlineNotice
                    tone="warning"
                    title="Task activity unavailable"
                  >
                    Counts are unavailable, not zero. Retry before treating this
                    team as idle.
                  </InlineNotice>
                ) : tasksQuery.isLoading ? (
                  <Text color="muted">Loading task activity…</Text>
                ) : attentionTasks.length ? (
                  <Stack gap={2}>
                    {attentionTasks.map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => navigate(`/tasks/${task.id}`)}
                        style={{
                          alignItems: 'center',
                          background: theme.color.bg.surface,
                          border: `1px solid ${theme.color.border.DEFAULT}`,
                          borderRadius: theme.radius.md,
                          color: theme.color.text.DEFAULT,
                          cursor: 'pointer',
                          display: 'flex',
                          font: 'inherit',
                          gap: theme.spacing[3],
                          justifyContent: 'space-between',
                          minHeight: '3.5rem',
                          padding: `${theme.spacing[2]} ${theme.spacing[3]}`,
                          textAlign: 'left',
                          width: '100%',
                        }}
                      >
                        <Stack gap={0} style={{ minWidth: 0 }}>
                          <Text weight="medium">
                            {task.title ?? task.taskType}
                          </Text>
                          <Text variant="caption" color="muted" mono>
                            {task.id}
                          </Text>
                        </Stack>
                        <Stack direction="row" gap={2} align="center">
                          <Badge
                            variant={
                              task.status === 'failed' ? 'error' : 'warning'
                            }
                          >
                            {task.status}
                          </Badge>
                          <ArrowRight aria-hidden="true" size={17} />
                        </Stack>
                      </button>
                    ))}
                    {countsArePartial ? (
                      <Text variant="caption" color="muted">
                        Attention items are drawn from the {loadedTaskCount}{' '}
                        most recently loaded of {taskTotal} tasks.
                      </Text>
                    ) : null}
                  </Stack>
                ) : (
                  <EmptyState
                    compact
                    title="No loaded tasks need attention"
                    description="No failed or waiting tasks appear in the current result set."
                  />
                )}
              </Stack>
            </ControlSurface>

            <ControlSurface as="section" padding="md">
              <Stack gap={4}>
                <Stack gap={1}>
                  <Text variant="overline" color="accent">
                    Authority boundary
                  </Text>
                  <Text variant="h3">
                    Agents should not inherit your authority
                  </Text>
                </Stack>
                <Text color="secondary">
                  A task claim selects work. Agent keys establish machine
                  identity; runtime profiles and tool policies constrain
                  execution. Keep those decisions explicit before broadening
                  access.
                </Text>
                <DescriptionList
                  columns={2}
                  items={[
                    {
                      label: 'Agent members',
                      value: valueOrDash(agentMembers, teamQuery),
                    },
                    {
                      label: 'Active agent keys',
                      value: valueOrDash(activeKeys, keysQuery),
                    },
                    {
                      label: 'Enforced profiles',
                      value: valueOrDash(enforcedProfiles, profilesQuery),
                    },
                    {
                      label: 'Open policy surface',
                      value: 'Tool policies',
                    },
                  ]}
                />
                <Stack direction="row" gap={2} wrap>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate('/runtime/policies')}
                  >
                    Review policies
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/runtime/agent-keys')}
                  >
                    Review agent keys
                  </Button>
                </Stack>
              </Stack>
            </ControlSurface>
          </div>

          <InlineNotice tone="info" title="Task-level evidence">
            Open any task to inspect the live contract → claim → runtime →
            result → knowledge record. Missing evidence is shown as missing,
            never inferred from a successful status.
          </InlineNotice>
        </>
      ) : null}
    </Stack>
  );
}

type QueryLike = {
  isError: boolean;
  isLoading: boolean;
};

function queryStatus(query: QueryLike) {
  if (query.isError) return 'unavailable' as const;
  if (query.isLoading) return 'loading' as const;
  return 'connected' as const;
}

function mergeQueryStatus(...queries: QueryLike[]) {
  if (queries.some((query) => query.isError)) return 'unavailable' as const;
  if (queries.some((query) => query.isLoading)) return 'loading' as const;
  return 'connected' as const;
}

function valueOrDash(value: ReactNode, query: QueryLike): ReactNode {
  return query.isError || query.isLoading ? '—' : value;
}

function SystemPanel({
  icon,
  eyebrow,
  title,
  description,
  status,
  metrics,
  actionLabel,
  onAction,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  status: 'connected' | 'loading' | 'unavailable';
  metrics: Array<{ label: ReactNode; value: ReactNode }>;
  actionLabel: string;
  onAction: () => void;
}) {
  const theme = useTheme();
  const statusMeta = {
    connected: { label: 'Connected', variant: 'success' as const },
    loading: { label: 'Loading', variant: 'default' as const },
    unavailable: { label: 'Unavailable', variant: 'warning' as const },
  }[status];

  return (
    <ControlSurface as="article" padding="md" style={{ height: '100%' }}>
      <Stack gap={5} style={{ height: '100%' }}>
        <Stack gap={3}>
          <Stack direction="row" justify="space-between" align="flex-start">
            <span
              aria-hidden="true"
              style={{
                alignItems: 'center',
                background: theme.color.primary.subtle,
                border: `1px solid ${theme.color.border.DEFAULT}`,
                borderRadius: theme.radius.md,
                color: theme.color.primary.DEFAULT,
                display: 'inline-flex',
                height: '2.5rem',
                justifyContent: 'center',
                width: '2.5rem',
              }}
            >
              {icon}
            </span>
            <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
          </Stack>
          <Stack gap={1}>
            <Text variant="overline" color="primary">
              {eyebrow}
            </Text>
            <Text variant="h3">{title}</Text>
            <Text color="secondary">{description}</Text>
          </Stack>
        </Stack>
        <DescriptionList items={metrics} columns={3} compact />
        <Button
          variant="ghost"
          size="sm"
          onClick={onAction}
          style={{ alignSelf: 'flex-start', marginTop: 'auto' }}
        >
          {actionLabel}
          <ArrowRight aria-hidden="true" size={16} />
        </Button>
      </Stack>
    </ControlSurface>
  );
}
