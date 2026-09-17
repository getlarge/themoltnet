import {
  Badge,
  Button,
  ControlSurface,
  DescriptionList,
  Stack,
  Text,
} from '@themoltnet/design-system';
import { useEffect, useRef, useState } from 'react';

import { desktopBridge } from '../bridge.js';
import { duration, pluralize, relativeTime } from './format.js';
import { ProfileChain, TaskTypeRow } from './RunsView.js';
import type { DesktopRun, RunCenterActions } from './types.js';

export interface RunDetailProps {
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
  run,
  actions,
  now,
  onBack,
  onRunAgain,
}: RunDetailProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [follow, setFollow] = useState(true);
  const [stopping, setStopping] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    setLines([]);
    return actions.subscribeRunLogs(run.id, (line) =>
      setLines((current) => [...current, line]),
    );
  }, [actions, run.id]);

  useEffect(() => {
    if (follow && logRef.current)
      logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [follow, lines]);

  const badge = STATUS_BADGE[run.status];
  const live = run.status === 'running';

  return (
    <Stack gap={6}>
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
                  void actions
                    .stopRun(run.id)
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
