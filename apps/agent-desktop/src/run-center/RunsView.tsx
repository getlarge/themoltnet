import {
  Badge,
  Button,
  ControlSurface,
  EmptyState,
  InlineNotice,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useState } from 'react';

import { duration, relativeTime } from './format.js';
import type { RunsRoute } from './RunCenterApp.js';
import { RunComposer } from './RunComposer.js';
import { RunDetail } from './RunDetail.js';
import type { DesktopRun, RunCenterActions, RunCenterData } from './types.js';

export interface RunsViewProps {
  active?: boolean;
  data: RunCenterData;
  actions: RunCenterActions;
  now: number;
  route: RunsRoute;
  onRoute: (route: RunsRoute) => void;
  onTeams?: () => void;
}

export function RunsView({
  active = true,
  data,
  actions,
  now,
  route,
  onRoute,
  onTeams,
}: RunsViewProps) {
  if (route.kind === 'compose') {
    return (
      <RunComposer
        key={route.previousRun?.id ?? route.presetId ?? 'new'}
        active={active}
        previousRun={route.previousRun}
        data={data}
        actions={actions}
        presetId={route.presetId}
        now={now}
        onTeams={onTeams}
        onDone={() => onRoute({ kind: 'list' })}
      />
    );
  }
  if (route.kind === 'detail') {
    const run = data.runs.find((candidate) => candidate.id === route.runId);
    if (run) {
      return (
        <RunDetail
          run={run}
          actions={actions}
          now={now}
          onBack={() => onRoute({ kind: 'list' })}
          onRunAgain={() =>
            onRoute({ kind: 'compose', presetId: null, previousRun: run })
          }
        />
      );
    }
  }
  return (
    <RunsList
      data={data}
      actions={actions}
      now={now}
      onRoute={onRoute}
      onTeams={onTeams}
    />
  );
}

function RunsList({
  data,
  actions,
  now,
  onRoute,
  onTeams,
}: Omit<RunsViewProps, 'route'>) {
  const theme = useTheme();
  const [stopping, setStopping] = useState<string | null>(null);
  const [stopError, setStopError] = useState(false);
  const active = data.runs.filter((run) => run.status === 'running');
  const recent = data.runs.filter((run) => run.status !== 'running');
  const serverReady = ['running', 'update_available'].includes(
    data.server.state,
  );

  const stop = async (runId: string) => {
    setStopping(runId);
    setStopError(false);
    try {
      await actions.stopRun(runId);
    } catch {
      // Without this the spinner clears and the run keeps polling, so the
      // failure is invisible. RunDetail surfaces the same notice.
      setStopError(true);
    } finally {
      setStopping(null);
    }
  };

  return (
    <Stack gap={6}>
      <Stack
        direction="row"
        justify="space-between"
        align="center"
        wrap
        gap={4}
      >
        <Stack gap={1} style={{ minWidth: '18rem', flex: 1 }}>
          <Text as="h1" variant="h4">
            Runs
          </Text>
          <Text variant="caption" color="secondary">
            Polling workers on this Mac. Closing the window does not stop them.
          </Text>
        </Stack>
        <Button
          size="sm"
          disabled={!serverReady}
          onClick={() => onRoute({ kind: 'compose', presetId: null })}
        >
          New run
        </Button>
      </Stack>

      {stopError ? (
        <InlineNotice tone="warning" title="Run could not be stopped">
          Try again or check the Server view.
        </InlineNotice>
      ) : null}

      {!serverReady ? (
        <InlineNotice tone="warning" title="The Agent Server is not running">
          Runs need the local server. Start it from the Server view, then come
          back.
        </InlineNotice>
      ) : null}

      {serverReady && !data.catalogue?.teams.some((team) => team.available) ? (
        <InlineNotice tone="warning" title="Team enrollment required">
          Enroll an identity before starting a run.{' '}
          <Button variant="ghost" onClick={onTeams}>
            Identity and teams
          </Button>
        </InlineNotice>
      ) : null}
      {active.length ? (
        <Stack gap={3}>
          <SectionLabel>Active</SectionLabel>
          <Stack gap={3}>
            {active.map((run) => (
              <ActiveRunCard
                key={run.id}
                run={run}
                now={now}
                stopping={stopping === run.id}
                onStop={() => void stop(run.id)}
                onOpen={() => onRoute({ kind: 'detail', runId: run.id })}
              />
            ))}
          </Stack>
        </Stack>
      ) : null}

      {recent.length ? (
        <Stack gap={3}>
          <SectionLabel>Recent</SectionLabel>
          <ControlSurface padding="none">
            {recent.map((run, index) => (
              <div
                key={run.id}
                style={{
                  borderTop:
                    index === 0
                      ? 'none'
                      : `1px solid ${theme.color.border.DEFAULT}`,
                }}
              >
                <RecentRunRow
                  run={run}
                  now={now}
                  onOpen={() => onRoute({ kind: 'detail', runId: run.id })}
                  onRunAgain={() =>
                    onRoute({
                      kind: 'compose',
                      presetId: null,
                      previousRun: run,
                    })
                  }
                />
              </div>
            ))}
          </ControlSurface>
        </Stack>
      ) : null}

      {!active.length && !recent.length ? (
        <ControlSurface padding="lg">
          <EmptyState
            title="No runs on this machine yet"
            description={
              <>
                A run is one worker process that claims tasks for a team and
                executes them under a runtime profile you picked in Console. It
                idles quietly until matching work appears.
              </>
            }
            action={
              <Button
                size="sm"
                disabled={!serverReady}
                onClick={() => onRoute({ kind: 'compose', presetId: null })}
              >
                Start your first run
              </Button>
            }
          />
        </ControlSurface>
      ) : null}
    </Stack>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text variant="overline" color="muted">
      {children}
    </Text>
  );
}

function ActiveRunCard({
  run,
  now,
  stopping,
  onStop,
  onOpen,
}: {
  run: DesktopRun;
  now: number;
  stopping: boolean;
  onStop: () => void;
  onOpen: () => void;
}) {
  return (
    <ControlSurface tone="network" active padding="md" as="article">
      <Stack gap={3}>
        <Stack
          direction="row"
          justify="space-between"
          align="flex-start"
          gap={4}
          wrap
        >
          <Stack gap={1} style={{ minWidth: 0 }}>
            <Stack direction="row" gap={2} align="center">
              <span className="run-dot run-dot--live" aria-hidden="true" />
              <Text
                as="span"
                variant="caption"
                mono
                color="accent"
                style={{ color: 'var(--molt-success)' }}
              >
                polling
              </Text>
              {run.presetName ? (
                <Text as="span" variant="caption" color="muted">
                  · {run.presetName}
                </Text>
              ) : null}
            </Stack>
            <Text as="h2" variant="bodyLarge" weight="semibold">
              {run.agent}
            </Text>
            <Text variant="caption" color="muted">
              {run.teamName}
            </Text>
          </Stack>
          <Stack gap={1} align="flex-end">
            <Text as="span" mono variant="caption" color="secondary">
              {duration(run.startedAt, now)}
            </Text>
            <Text as="span" variant="caption" color="muted">
              elapsed
            </Text>
          </Stack>
        </Stack>

        <ProfileChain profiles={run.profiles} />
        <TaskTypeRow taskTypes={run.taskTypes} showLabel={false} />

        <Stack
          direction="row"
          justify="space-between"
          align="center"
          gap={4}
          wrap
        >
          <Text variant="caption" color="secondary">
            Claiming for {run.teamName ?? 'this team'} · started{' '}
            {relativeTime(run.startedAt, now)}
          </Text>
          <Stack direction="row" gap={2}>
            <Button variant="ghost" size="sm" onClick={onOpen}>
              Logs
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={stopping}
              loadingLabel="Stopping run"
              onClick={onStop}
            >
              Stop
            </Button>
          </Stack>
        </Stack>
      </Stack>
    </ControlSurface>
  );
}

function RecentRunRow({
  run,
  now,
  onOpen,
  onRunAgain,
}: {
  run: DesktopRun;
  now: number;
  onOpen: () => void;
  onRunAgain: () => void;
}) {
  const failed = run.status === 'failed';
  return (
    <Stack
      direction="row"
      gap={4}
      align="flex-start"
      wrap
      style={{ padding: '0.875rem 1.25rem' }}
    >
      <span
        className={`run-dot run-dot--${failed ? 'error' : 'default'}`}
        aria-hidden="true"
        style={{ marginTop: '0.45rem' }}
      />
      <Stack gap={1} style={{ flex: 1, minWidth: '14rem' }}>
        <Stack direction="row" gap={2} align="center" wrap>
          <Text as="span" weight="medium">
            {run.agent}
          </Text>
          <Text as="span" variant="caption" color="muted" mono>
            {run.profiles.join(' → ')}
          </Text>
        </Stack>
        <Text variant="caption" color="muted">
          {failed ? 'Failed' : 'Stopped'}{' '}
          {relativeTime(run.endedAt ?? null, now)}
          {run.exitCode !== undefined && run.exitCode !== null
            ? ` · exit ${run.exitCode}`
            : ''}
        </Text>
        {failed ? (
          <Text variant="caption" color="error">
            {run.lastError?.message ?? 'Open the log to see why it stopped.'}
          </Text>
        ) : null}
      </Stack>
      <Stack direction="row" gap={2}>
        <Button variant="ghost" size="sm" onClick={onOpen}>
          Logs
        </Button>
        <Button variant="secondary" size="sm" onClick={onRunAgain}>
          Run again
        </Button>
      </Stack>
    </Stack>
  );
}

/** The ordered profile chain. Order is the contract: first one that can run wins. */
export function ProfileChain({ profiles }: { profiles: string[] }) {
  const theme = useTheme();
  return (
    <Stack direction="row" gap={2} align="center" wrap>
      {profiles.map((name, index) => (
        <Stack key={name} direction="row" gap={2} align="center">
          {index > 0 ? (
            <Text as="span" variant="caption" color="muted" aria-hidden="true">
              →
            </Text>
          ) : null}
          <span
            style={{
              border: `1px solid ${index === 0 ? theme.color.border.hover : theme.color.border.DEFAULT}`,
              borderRadius: theme.radius.sm,
              color:
                index === 0
                  ? theme.color.text.DEFAULT
                  : theme.color.text.secondary,
              fontFamily: theme.font.family.mono,
              fontSize: theme.font.size.xs,
              padding: '0.2rem 0.45rem',
            }}
          >
            {name}
          </span>
        </Stack>
      ))}
      <Text as="span" variant="caption" color="muted">
        {profiles.length > 1 ? 'primary, then fallback' : 'runtime profile'}
      </Text>
    </Stack>
  );
}

export function TaskTypeRow({
  taskTypes,
  showLabel = true,
}: {
  taskTypes: string[];
  showLabel?: boolean;
}) {
  return (
    <Stack direction="row" gap={2} align="center" wrap>
      {taskTypes.map((type) => (
        <Badge key={type} variant="default">
          <span style={{ fontFamily: 'inherit' }}>{type}</span>
        </Badge>
      ))}
      {showLabel ? (
        <Text as="span" variant="caption" color="muted">
          {taskTypes.length === 1 ? 'task type claimed' : 'task types claimed'}
        </Text>
      ) : null}
    </Stack>
  );
}
