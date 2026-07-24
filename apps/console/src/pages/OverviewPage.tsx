import { getTeamOptions, listTasksOptions } from '@moltnet/api-client/query';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  Divider,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useMemo } from 'react';
import { useLocation } from 'wouter';

import { getApiClient } from '../api.js';
import { useAuth } from '../auth/useAuth.js';
import { getConfig } from '../config.js';
import { useDiarySummaries } from '../diaries/hooks.js';
import { buildTeamPilotBriefing } from '../overview/team-pilot.js';
import { useTeam } from '../team/useTeam.js';

const statusLabel = {
  not_started: 'Not started',
  ready: 'Ready',
  in_progress: 'In progress',
  needs_attention: 'Needs attention',
  unavailable: 'Unavailable',
  complete: 'Complete',
} as const;

const statusVariant = {
  not_started: 'default',
  ready: 'accent',
  in_progress: 'primary',
  needs_attention: 'error',
  unavailable: 'warning',
  complete: 'success',
} as const;

export function OverviewPage() {
  const theme = useTheme();
  const { username } = useAuth();
  const { error: teamError, isLoading: teamsLoading, selectedTeam } = useTeam();
  const [, navigate] = useLocation();
  const teamId = selectedTeam?.id ?? '';
  const hasProjectTeam = Boolean(selectedTeam && !selectedTeam.personal);
  const { docsUrl } = getConfig();

  const diariesQuery = useDiarySummaries(hasProjectTeam ? teamId : null);
  const teamQuery = useQuery({
    ...getTeamOptions({ client: getApiClient(), path: { id: teamId } }),
    enabled: hasProjectTeam,
    staleTime: 30_000,
  });
  const tasksQuery = useQuery({
    ...listTasksOptions({
      client: getApiClient(),
      headers: { 'x-moltnet-team-id': teamId },
      query: { limit: 50 },
    }),
    enabled: hasProjectTeam,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const isLoading =
    teamsLoading ||
    (hasProjectTeam &&
      (diariesQuery.isLoading || teamQuery.isLoading || tasksQuery.isLoading));

  const briefing = useMemo(
    () =>
      buildTeamPilotBriefing({
        team: selectedTeam,
        diaries: diariesQuery.error ? null : (diariesQuery.data ?? []),
        docsUrl,
        members: teamQuery.error ? null : (teamQuery.data?.members ?? []),
        tasks: tasksQuery.error ? null : (tasksQuery.data?.items ?? []),
      }),
    [
      diariesQuery.data,
      diariesQuery.error,
      docsUrl,
      selectedTeam,
      tasksQuery.data,
      tasksQuery.error,
      teamQuery.data,
      teamQuery.error,
    ],
  );

  if (isLoading) {
    return (
      <Stack gap={2}>
        <Text variant="h1">Team pilot</Text>
        <Text color="muted">Loading the current pilot briefing…</Text>
      </Stack>
    );
  }

  if (teamError) {
    return (
      <Stack gap={4}>
        <Text variant="h1">Team pilot</Text>
        <Card variant="outlined" padding="md">
          <Stack gap={3}>
            <Text variant="h3">Pilot status is unavailable</Text>
            <Text color="muted">
              The console could not load the selected team. Check connectivity,
              then try the relevant workspace directly.
            </Text>
            <Stack direction="row" gap={3} wrap>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate('/teams')}
              >
                Open teams
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate('/tasks')}
              >
                Open tasks
              </Button>
            </Stack>
          </Stack>
        </Card>
      </Stack>
    );
  }

  return (
    <Stack gap={6}>
      <Stack gap={1}>
        <Text variant="h1">Team pilot{username ? `, ${username}` : ''}</Text>
        <Text color="muted">{briefing.summary}</Text>
      </Stack>

      <Card variant="outlined" padding="md" glow="accent">
        <Stack gap={2}>
          <Stack direction="row" gap={2} align="center" wrap>
            <Badge variant="warning">Review before queueing</Badge>
            <Text variant="h3">Cost is not estimated or capped here</Text>
          </Stack>
          <Text color="secondary">
            MoltNet currently does not show a cost estimate or enforce a spend
            cap for runtime tasks. Keep the first brief narrow and inspect the
            executor profile before an agent claims it.
          </Text>
        </Stack>
      </Card>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: theme.spacing[4],
        }}
      >
        {briefing.phases.map((phase, index) => {
          const external = phase.action.href.startsWith('http');
          return (
            <Card key={phase.id} variant="surface" padding="md">
              <Stack gap={4} style={{ height: '100%' }}>
                <Stack
                  direction="row"
                  justify="space-between"
                  gap={2}
                  align="center"
                >
                  <Text variant="overline" color="accent">
                    {index + 1}. {phase.label}
                  </Text>
                  <Badge variant={statusVariant[phase.status]}>
                    {statusLabel[phase.status]}
                  </Badge>
                </Stack>
                <Stack gap={2} style={{ flex: 1 }}>
                  <Text variant="h3">{phase.title}</Text>
                  <Text color="muted">{phase.detail}</Text>
                </Stack>
                {external ? (
                  <a
                    href={phase.action.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ alignSelf: 'flex-start' }}
                  >
                    <Button variant="secondary" size="sm">
                      {phase.action.label}
                    </Button>
                  </a>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate(phase.action.href)}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    {phase.action.label}
                  </Button>
                )}
              </Stack>
            </Card>
          );
        })}
      </div>

      <details>
        <summary
          style={{
            cursor: 'pointer',
            color: theme.color.primary.DEFAULT,
            fontWeight: 600,
          }}
        >
          Pilot checks and activity
        </summary>
        <Stack gap={3} style={{ marginTop: theme.spacing[4] }}>
          <Divider />
          <Text color="muted">
            {hasProjectTeam && selectedTeam
              ? `Current project team: ${selectedTeam.name}.`
              : 'A personal team is selected. Choose a non-personal project team for a shared pilot.'}
          </Text>
          <Text color="muted">
            {briefing.agentMember
              ? `Team agent: ${briefing.agentMember.displayName}. Owner or manager membership is the conventional claim path, while diary writer grants can also authorize claims. Visible membership does not prove that agent-daemon is running.`
              : 'No agent is visible in the selected project team.'}
          </Text>
          <Text color="muted">
            {briefing.queuedTaskCount} queued, {briefing.activeTaskCount}{' '}
            active, {briefing.waitingTaskCount} condition-waiting,{' '}
            {briefing.completedTaskCount} completed, and{' '}
            {briefing.failedTaskCount} unsuccessful in the loaded queue.
          </Text>
          <Stack direction="row" gap={3} wrap>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/teams')}
            >
              Team details
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/diaries')}
            >
              Diary details
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/tasks')}
            >
              Full task activity
            </Button>
          </Stack>
        </Stack>
      </details>
    </Stack>
  );
}
