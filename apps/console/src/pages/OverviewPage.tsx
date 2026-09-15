import {
  getTeamOptions,
  listAgentKeysOptions,
  listRuntimeProfilesOptions,
  listTasksOptions,
} from '@moltnet/api-client/query';
import { useQuery } from '@tanstack/react-query';
import {
  ActionLink,
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
  CheckCircle2,
  Circle,
  CircleDot,
  ExternalLink,
  LibraryBig,
  ListTodo,
  ShieldCheck,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useLocation } from 'wouter';

import { getApiClient } from '../api.js';
import { getConfig } from '../config.js';
import { useDiarySummaries } from '../diaries/hooks.js';
import {
  buildTeamPilotBriefing,
  type PilotResource,
  type PilotStep,
} from '../overview/team-pilot.js';
import { canManageTeam } from '../team/permissions.js';
import { useTeam } from '../team/useTeam.js';

const TEAM_HEADER = 'x-moltnet-team-id';

export function OverviewPage() {
  const theme = useTheme();
  const [, navigate] = useLocation();
  const { error: teamError, isLoading: teamsLoading, selectedTeam } = useTeam();
  const teamId = selectedTeam?.id ?? '';
  const hasProjectTeam = Boolean(selectedTeam && !selectedTeam.personal);
  const canManage = canManageTeam(selectedTeam?.role);

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
  const completedTaskQuery = useQuery({
    ...listTasksOptions({
      client: getApiClient(),
      headers: { [TEAM_HEADER]: teamId },
      query: { status: 'completed', limit: 1 },
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
      query: { status: 'active', limit: 50 },
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
  const briefing = buildTeamPilotBriefing({
    team: teamsLoading
      ? { status: 'loading' }
      : teamError
        ? { status: 'unavailable' }
        : { status: 'ready', data: selectedTeam },
    diaries: pilotResource(diariesQuery, diaries),
    members: pilotResource(teamQuery, teamQuery.data?.members ?? []),
    agentKeys: pilotResource(keysQuery, {
      items: keys,
      isPartial: keyCountIsPartial,
    }),
    runtimeProfiles: pilotResource(profilesQuery, profiles),
    completedTasks: pilotResource(
      completedTaskQuery,
      completedTaskQuery.data?.items ?? [],
    ),
    activityTasks: pilotResource(tasksQuery, tasks),
    canManage,
  });

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
        <TeamPilot briefing={briefing} />
      ) : teamError ? (
        <InlineNotice tone="error" title="Team scope unavailable">
          The console could not load the selected team. Open Teams to restore
          the operator scope before making changes.
        </InlineNotice>
      ) : !briefing.isActivated ? (
        <TeamPilot briefing={briefing} />
      ) : briefing.recordTask ? (
        <FirstRecordLine taskId={briefing.recordTask.id} />
      ) : null}

      {hasProjectTeam && !teamsLoading && !teamError ? (
        <>
          <section aria-labelledby="systems-heading">
            <Stack gap={4}>
              <Text id="systems-heading" variant="h2">
                System status
              </Text>
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

function docsHref(path: string) {
  return `${getConfig().docsUrl.replace(/\/$/, '')}${path}`;
}

function TeamPilot({
  briefing,
}: {
  briefing: ReturnType<typeof buildTeamPilotBriefing>;
}) {
  const theme = useTheme();
  const [, navigate] = useLocation();
  const next = briefing.nextStep;
  if (!next) return null;

  const stepCount = briefing.steps.length;
  const nextNumber = briefing.steps.indexOf(next) + 1;
  const completedCount = briefing.steps.filter(
    (step) => step.status === 'complete',
  ).length;
  const guideVariant =
    next.status === 'next' ? ('primary' as const) : ('secondary' as const);

  return (
    <ControlSurface as="section" padding="lg" aria-labelledby="pilot-heading">
      <div
        style={{
          display: 'grid',
          gap: theme.spacing[6],
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(100%, 22rem), 1fr))',
        }}
      >
        <Stack gap={5}>
          <Stack direction="row" gap={3} align="center" wrap>
            <span
              aria-hidden="true"
              style={{
                alignItems: 'center',
                background: theme.color.primary.subtle,
                border: `1px solid ${theme.color.border.DEFAULT}`,
                borderRadius: theme.radius.md,
                color: theme.color.primary.DEFAULT,
                display: 'inline-flex',
                height: '2.75rem',
                justifyContent: 'center',
                width: '2.75rem',
              }}
            >
              <Bot size={21} strokeWidth={1.8} />
            </span>
            <Stack gap={0}>
              <Text variant="overline" color="primary">
                Getting started
              </Text>
              <Text variant="caption" color="muted">
                {completedCount} of {stepCount} steps done
              </Text>
            </Stack>
          </Stack>

          <Stack gap={2}>
            <Badge
              variant={
                next.status === 'unavailable'
                  ? 'warning'
                  : next.status === 'loading'
                    ? 'default'
                    : 'primary'
              }
              style={{ alignSelf: 'flex-start' }}
            >
              {next.status === 'unavailable'
                ? 'Unavailable'
                : next.status === 'loading'
                  ? 'Checking'
                  : `Step ${nextNumber} of ${stepCount}`}
            </Badge>
            <Text id="pilot-heading" variant="h2">
              {next.label}
            </Text>
            <Text weight="medium">{next.title}</Text>
            <Text color="secondary" style={{ maxWidth: '68ch' }}>
              {next.detail}
            </Text>
          </Stack>

          <Stack direction="row" gap={2} wrap>
            <ActionLink
              variant={guideVariant}
              size="sm"
              href={docsHref(next.docsPath)}
              target="_blank"
              rel="noreferrer"
            >
              Read step {nextNumber} in the docs
              <ExternalLink aria-hidden="true" size={15} />
            </ActionLink>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate(next.action.href)}
            >
              {next.action.label}
              <ArrowRight aria-hidden="true" size={16} />
            </Button>
          </Stack>
        </Stack>

        <ol
          aria-label="Getting started steps"
          style={{
            display: 'grid',
            gap: theme.spacing[1],
            listStyle: 'none',
            margin: 0,
            padding: 0,
          }}
        >
          {briefing.steps.map((step, index) => (
            <PilotStepRow key={step.id} number={index + 1} step={step} />
          ))}
        </ol>
      </div>
    </ControlSurface>
  );
}

function PilotStepRow({ number, step }: { number: number; step: PilotStep }) {
  const theme = useTheme();
  const [, navigate] = useLocation();
  const isCurrent = ['next', 'loading', 'unavailable'].includes(step.status);
  const statusLabel = {
    complete: 'Done',
    next: 'Next',
    upcoming: 'Upcoming',
    loading: 'Checking',
    unavailable: 'Unavailable',
  }[step.status];
  const icon =
    step.status === 'complete' ? (
      <CheckCircle2 aria-hidden="true" size={18} />
    ) : isCurrent ? (
      <CircleDot aria-hidden="true" size={18} />
    ) : (
      <Circle aria-hidden="true" size={18} />
    );
  const showRecordLink = step.id === 'record' && step.status === 'complete';

  return (
    <li
      aria-current={isCurrent ? 'step' : undefined}
      style={{
        alignItems: 'center',
        background: isCurrent ? theme.color.bg.elevated : 'transparent',
        borderRadius: theme.radius.md,
        color:
          step.status === 'complete' || isCurrent
            ? theme.color.text.DEFAULT
            : theme.color.text.muted,
        display: 'grid',
        gap: theme.spacing[3],
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        minHeight: '3rem',
        padding: `${theme.spacing[2]} ${theme.spacing[3]}`,
      }}
    >
      <span
        style={{
          color:
            step.status === 'complete'
              ? theme.color.success.DEFAULT
              : isCurrent
                ? theme.color.primary.DEFAULT
                : theme.color.text.muted,
          display: 'inline-flex',
        }}
      >
        {icon}
      </span>
      <Stack gap={0}>
        <Text weight={isCurrent ? 'medium' : 'normal'}>
          <a
            href={docsHref(step.docsPath)}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'inherit', textUnderlineOffset: '0.2em' }}
          >
            {number}. {step.label}
          </a>
        </Text>
        {showRecordLink ? (
          <Text variant="caption">
            <a
              href={step.action.href}
              onClick={(event) => {
                event.preventDefault();
                navigate(step.action.href);
              }}
              style={{ color: theme.color.primary.DEFAULT }}
            >
              {step.action.label}
            </a>
          </Text>
        ) : null}
      </Stack>
      <Text variant="caption" color={isCurrent ? 'secondary' : 'muted'}>
        {statusLabel}
      </Text>
    </li>
  );
}

/**
 * Once all three steps are done the card collapses to one line that keeps
 * the payoff reachable: the record of the first completed task.
 */
function FirstRecordLine({ taskId }: { taskId: string }) {
  const theme = useTheme();
  const [, navigate] = useLocation();
  const href = `/tasks/${taskId}`;

  return (
    <ControlSurface as="section" padding="sm" aria-label="First task record">
      <Stack
        direction="row"
        gap={3}
        align="center"
        justify="space-between"
        wrap
      >
        <Stack direction="row" gap={2} align="center">
          <span
            style={{
              color: theme.color.success.DEFAULT,
              display: 'inline-flex',
            }}
          >
            <CheckCircle2 aria-hidden="true" size={18} />
          </span>
          <Text>Your agent completed its first task.</Text>
        </Stack>
        <ActionLink
          variant="secondary"
          size="sm"
          href={href}
          onClick={(event) => {
            event.preventDefault();
            navigate(href);
          }}
        >
          See what your agent did
          <ArrowRight aria-hidden="true" size={16} />
        </ActionLink>
      </Stack>
    </ControlSurface>
  );
}

type QueryLike = {
  isError: boolean;
  isLoading: boolean;
};

function pilotResource<T>(query: QueryLike, data: T): PilotResource<T> {
  if (query.isError) return { status: 'unavailable' };
  if (query.isLoading) return { status: 'loading' };
  return { status: 'ready', data };
}

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
