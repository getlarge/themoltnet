import {
  Badge,
  Button,
  ControlSurface,
  DescriptionList,
  InlineNotice,
  Stack,
  Text,
} from '@themoltnet/design-system';
import { useEffect, useRef, useState } from 'react';

import { desktopBridge } from '../bridge.js';
import { expiryLabel } from './credential-health.js';
import { duration, pluralize, relativeTime } from './format.js';
import { workspaceLabel } from './ProjectsView.js';
import { ProfileChain, TaskTypeRow } from './RunsView.js';
import type { DesktopRun, RunCenterActions } from './types.js';
import { useCatalogue } from './useCatalogue.js';

export interface RunDetailProps {
  active?: boolean;
  run: DesktopRun;
  actions: RunCenterActions;
  now: number;
  onBack: () => void;
  onRunAgain: () => void;
}

const STATUS_BADGE = {
  running: { variant: 'success' as const, label: 'polling' },
  stopped: { variant: 'default' as const, label: 'stopped' },
  exited: { variant: 'default' as const, label: 'exited' },
  failed: { variant: 'error' as const, label: 'failed' },
};

export function RunDetail({
  active = true,
  run,
  actions,
  now,
  onBack,
  onRunAgain,
}: RunDetailProps) {
  // The run center already polls this identity's catalogue; reading the shared
  // entry replaces the second 30s timer this view used to run against it.
  const { catalogue } = useCatalogue(run.agent, {
    active,
    read: actions.catalogue,
  });
  const team = catalogue?.teams.find((entry) => entry.teamId === run.teamId);
  const currentCredential = team?.credential;
  const names = {
    project: catalogue?.projects.find(
      (entry) => entry.id === run.workspace?.projectId,
    )?.name,
    diary: team?.diaries.find((entry) => entry.id === run.workspace?.diaryId)
      ?.name,
  };
  const [lines, setLines] = useState<string[]>([]);
  const [follow, setFollow] = useState(true);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!active) return;
    setLines([]);
    return actions.subscribeRunLogs(run.id, setLines);
  }, [actions, run.id, active]);

  useEffect(() => {
    if (follow && logRef.current)
      logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [follow, lines]);

  const badge = STATUS_BADGE[run.status];
  const live = run.status === 'running';

  return (
    <Stack gap={6}>
      {run.workspace ? (
        <ControlSurface padding="md" as="section">
          <Stack gap={3}>
            <Text as="h2" variant="h4">
              Captured workspace
            </Text>
            <Text variant="caption" color="secondary">
              These settings were captured when the run started. Later location
              edits apply to subsequent runs.
            </Text>
            <DescriptionList
              items={[
                {
                  label: 'Project',
                  value: run.workspace.projectId
                    ? (names.project ?? run.workspace.projectId)
                    : 'General work',
                },
                {
                  label: 'Location',
                  value: run.workspace.location ?? 'Run only',
                },
                {
                  label: 'Diary',
                  value: run.workspace.diaryId
                    ? (names.diary ?? run.workspace.diaryId)
                    : 'No diary',
                },
                {
                  label: 'Folder',
                  value: run.workspace.source ?? 'No source folder',
                  mono: true,
                },
                {
                  label: 'Workspace',
                  value: workspaceLabel(run.workspace.strategy),
                },
              ]}
            />
          </Stack>
        </ControlSurface>
      ) : null}
      {stopError ? (
        <InlineNotice tone="warning" title="Run could not be stopped">
          Try again or check the Server view.
        </InlineNotice>
      ) : null}
      <Text variant="caption" color="secondary">
        Run credential: {expiryLabel(run.credential?.expiresAt)}
      </Text>
      {run.active &&
      currentCredential &&
      run.credential &&
      currentCredential.keyId !== run.credential.keyId ? (
        <InlineNotice
          tone="warning"
          title="Replacement available—restart to use it"
        >
          This run continues with its captured predecessor credential. Stop and
          restart it when ready.
        </InlineNotice>
      ) : null}
      <Stack gap={2}>
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          style={{ alignSelf: 'flex-start' }}
        >
          ← Runs
        </Button>
        <Stack
          direction="row"
          justify="space-between"
          align="flex-start"
          gap={4}
          wrap
        >
          <Stack gap={2}>
            <Stack direction="row" gap={3} align="center" wrap>
              <Text as="h1" variant="h4">
                {run.agent}
              </Text>
              <Badge variant={badge.variant}>{badge.label}</Badge>
              {run.presetName ? (
                <Text as="span" variant="caption" color="muted">
                  {run.presetName}
                </Text>
              ) : null}
            </Stack>
            <Text as="span" variant="caption" color="muted" mono>
              {run.id}
            </Text>
          </Stack>
          <Stack direction="row" gap={2}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void desktopBridge.openLogs()}
            >
              Open log folder
            </Button>
            {live ? (
              <Button
                variant="secondary"
                size="sm"
                loading={stopping}
                loadingLabel="Stopping run"
                onClick={() => {
                  setStopping(true);
                  setStopError(false);
                  void actions
                    .stopRun(run.id)
                    .catch(() => setStopError(true))
                    .finally(() => setStopping(false));
                }}
              >
                Stop
              </Button>
            ) : (
              <Button variant="accent" size="sm" onClick={onRunAgain}>
                Run again
              </Button>
            )}
          </Stack>
        </Stack>
      </Stack>

      {run.lastError ? (
        <InlineNotice
          tone="error"
          title="This run stopped because it could not continue"
        >
          <Stack gap={1}>
            <Text variant="caption">{run.lastError.message}</Text>
            <Text variant="caption" color="muted" mono>
              {run.lastError.code}
            </Text>
          </Stack>
        </InlineNotice>
      ) : null}

      <ControlSurface padding="md" as="section">
        <Stack gap={4}>
          <ProfileChain profiles={run.profiles} />
          <TaskTypeRow taskTypes={run.taskTypes} />
          <DescriptionList
            ariaLabel="Run facts"
            columns={4}
            compact
            items={[
              { label: 'Team', value: run.teamName },
              {
                label: live ? 'Elapsed' : 'Ran for',
                value: duration(
                  run.startedAt,
                  live ? now : Date.parse(run.endedAt ?? run.startedAt),
                ),
                mono: true,
              },
              { label: 'Started', value: relativeTime(run.startedAt, now) },
              {
                label: 'Ended',
                value: run.endedAt ? relativeTime(run.endedAt, now) : '—',
              },
              {
                label: 'PID',
                value: run.pid ? String(run.pid) : '—',
                mono: true,
              },
              {
                label: 'Exit code',
                value: run.exitCode === null ? '—' : String(run.exitCode),
                mono: true,
              },
            ]}
          />
        </Stack>
      </ControlSurface>

      <Stack gap={3}>
        <Stack
          direction="row"
          justify="space-between"
          align="center"
          gap={4}
          wrap
        >
          <Text variant="overline" color="muted">
            Log
          </Text>
          <Stack direction="row" gap={3} align="center">
            <Text variant="caption" color="muted">
              {pluralize(lines.length, 'line')}
            </Text>
            {live ? (
              <label className="checkbox-row checkbox-row--inline">
                <input
                  type="checkbox"
                  checked={follow}
                  onChange={(event) => setFollow(event.target.checked)}
                />
                <Text as="span" variant="caption">
                  Follow
                </Text>
              </label>
            ) : null}
          </Stack>
        </Stack>
        {/*
          Matches the scrollable-log pattern already used by Console's
          RunLogTail and the Server pane: labelled <pre>, no tab stop. Giving
          these regions keyboard reach is a repo-wide change, not a local one.
        */}
        <pre
          ref={logRef}
          className="log-preview log-preview--tall"
          aria-label={`Log for run ${run.id}`}
        >
          {lines.length ? lines.join('\n') : 'Waiting for output…'}
        </pre>
      </Stack>
    </Stack>
  );
}
