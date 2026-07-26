import { getTeamOptions, listTasksOptions } from '@moltnet/api-client/query';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Stack, Text, useTheme } from '@themoltnet/design-system';
import { useMemo } from 'react';
import { useLocation } from 'wouter';

import { getApiClient } from '../api.js';
import { useAuth } from '../auth/useAuth.js';
import { getConfig } from '../config.js';
import { useDiarySummaries } from '../diaries/hooks.js';
import {
  buildTeamPilotBriefing,
  type PilotPhase,
} from '../overview/team-pilot.js';
import { useTeam } from '../team/useTeam.js';

/**
 * Phase status → glyph + tone. The glyph carries state so it never reads by
 * color alone (WCAG 1.4.1).
 */
const PHASE_META: Record<
  PilotPhase['status'],
  { glyph: string; tone: 'success' | 'primary' | 'error' | 'warning' | 'muted' }
> = {
  complete: { glyph: '✓', tone: 'success' },
  ready: { glyph: '→', tone: 'primary' },
  in_progress: { glyph: '◐', tone: 'primary' },
  needs_attention: { glyph: '!', tone: 'error' },
  unavailable: { glyph: '?', tone: 'warning' },
  not_started: { glyph: '○', tone: 'muted' },
};

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

  const partialError =
    hasProjectTeam &&
    (diariesQuery.isError || teamQuery.isError || tasksQuery.isError);
  const allPhasesComplete = briefing.phases.every(
    (p) => p.status === 'complete',
  );

  // Operational truthfulness: keep "couldn't load" distinct from "zero", and
  // "loaded page" distinct from "team total".
  const tasksUnavailable = hasProjectTeam && tasksQuery.isError;
  const membershipUnavailable = hasProjectTeam && teamQuery.isError;
  const loadedTaskCount = tasksQuery.data?.items?.length ?? 0;
  const taskTotal = tasksQuery.data?.total ?? loadedTaskCount;
  // The lane counts are derived from the loaded page (limit 50); flag when the
  // team has more so the tiles aren't read as exact team-wide totals.
  const countsArePartial = !tasksUnavailable && taskTotal > loadedTaskCount;

  return (
    <Stack gap={6}>
      <Stack gap={1}>
        <Text variant="h1">Team pilot{username ? `, ${username}` : ''}</Text>
        <Text color="muted">{briefing.summary}</Text>
      </Stack>

      {partialError && (
        <Text style={{ color: theme.color.warning.DEFAULT }}>
          Some pilot data couldn&apos;t be loaded, so the state below may be
          incomplete.
        </Text>
      )}

      {/* Operational state — leads the page (was hidden in a disclosure). */}
      <Stack gap={3}>
        <Stack direction="row" justify="space-between" align="center" wrap>
          <SectionHeading>Task activity</SectionHeading>
          <button
            type="button"
            onClick={() => navigate('/tasks')}
            style={{
              background: 'none',
              border: 0,
              padding: 0,
              cursor: 'pointer',
              fontSize: theme.font.size.sm,
              color: theme.color.primary.DEFAULT,
            }}
          >
            Task board →
          </button>
        </Stack>
        {!hasProjectTeam ? (
          <Card variant="surface" padding="md">
            <Text color="muted">
              Task activity appears once a non-personal project team is running
              a pilot. Choose or create one below.
            </Text>
          </Card>
        ) : tasksUnavailable ? (
          <Card variant="surface" padding="md">
            <Stack direction="row" gap={3} align="center" wrap>
              <Text style={{ color: theme.color.warning.DEFAULT }}>
                Task activity couldn&apos;t be loaded — counts are unavailable,
                not zero.
              </Text>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void tasksQuery.refetch()}
              >
                Retry
              </Button>
            </Stack>
          </Card>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: theme.spacing[3],
            }}
          >
            <TaskStatTile
              count={briefing.queuedTaskCount}
              label="Queued"
              color={theme.color.info.DEFAULT}
            />
            <TaskStatTile
              count={briefing.activeTaskCount}
              label="Active"
              color={theme.color.primary.DEFAULT}
            />
            <TaskStatTile
              count={briefing.waitingTaskCount}
              label="Waiting"
              color={theme.color.warning.DEFAULT}
            />
            <TaskStatTile
              count={briefing.completedTaskCount}
              label="Completed"
              color={theme.color.success.DEFAULT}
            />
            <TaskStatTile
              count={briefing.failedTaskCount}
              label="Unsuccessful"
              color={theme.color.error.DEFAULT}
            />
          </div>
        )}
        {countsArePartial && (
          <Text variant="caption" color="muted">
            Counts reflect the {loadedTaskCount} most recently loaded of{' '}
            {taskTotal} tasks — open the task board for the full queue.
          </Text>
        )}
        {hasProjectTeam && (
          <Text variant="caption" color="muted">
            {membershipUnavailable
              ? "Team membership couldn't be loaded, so agent presence is unknown."
              : briefing.agentMember
                ? `Agent: ${briefing.agentMember.displayName} · ${briefing.agentMember.role}. Membership doesn't prove agent-daemon is running; a diary-writer grant can also authorize claims.`
                : 'No agent is a member of this team. An agent can claim work through team membership or a diary-writer grant.'}
          </Text>
        )}
      </Stack>

      {/* Setup — prominent while incomplete, collapses to a summary once done. */}
      {allPhasesComplete ? (
        <Card variant="surface" padding="sm">
          <Stack direction="row" gap={2} align="center">
            <Text style={{ color: theme.color.success.DEFAULT }}>✓</Text>
            <Text variant="caption" color="secondary">
              Pilot setup complete — workspace, agent, and first task are all in
              place.
            </Text>
          </Stack>
        </Card>
      ) : (
        <Stack gap={3}>
          <SectionHeading>Pilot setup</SectionHeading>
          <Stack gap={2}>
            {briefing.phases.map((phase) => (
              <PhaseRow key={phase.id} phase={phase} onNavigate={navigate} />
            ))}
          </Stack>
        </Stack>
      )}

      {/* Standing caveat — honest, but a calm note rather than a glowing banner. */}
      <Card variant="outlined" padding="sm">
        <Stack direction="row" gap={2} align="flex-start">
          <Text
            aria-hidden="true"
            style={{ color: theme.color.warning.DEFAULT }}
          >
            ⚠
          </Text>
          <Text variant="caption" color="secondary">
            <strong>Cost is not estimated or capped here.</strong> MoltNet
            doesn&apos;t show a cost estimate or enforce a spend cap for runtime
            tasks — keep the first brief narrow and inspect the executor profile
            before an agent claims it.
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
}

/** A small uppercase section label that is also a real `<h2>`, so the page has
 *  an h1 → h2 structure and the tile counts don't have to be headings. */
function SectionHeading({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <h2
      style={{
        margin: 0,
        fontSize: theme.font.size.xs,
        fontWeight: theme.font.weight.medium,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: theme.color.text.secondary,
      }}
    >
      {children}
    </h2>
  );
}

function TaskStatTile({
  count,
  label,
  color,
}: {
  count: number;
  label: string;
  color: string;
}) {
  const theme = useTheme();
  return (
    <Card
      variant="surface"
      padding="md"
      data-testid={`task-tile-${label.toLowerCase()}`}
    >
      <Stack gap={1}>
        {/* The count is data, not a heading — otherwise screen-reader heading
            navigation is a list of contextless numbers. The colored dot beside
            the label carries lane identity, so state never reads by color
            alone. */}
        <span
          style={{
            fontSize: theme.font.size['3xl'],
            fontWeight: theme.font.weight.semibold,
            lineHeight: theme.font.lineHeight.tight,
            color: theme.color.text.DEFAULT,
          }}
        >
          {count}
        </span>
        <Stack direction="row" gap={1.5} align="center">
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: theme.radius.full,
              background: color,
              flexShrink: 0,
            }}
          />
          <Text variant="caption" color="secondary">
            {label}
          </Text>
        </Stack>
      </Stack>
    </Card>
  );
}

function PhaseRow({
  phase,
  onNavigate,
}: {
  phase: PilotPhase;
  onNavigate: (href: string) => void;
}) {
  const theme = useTheme();
  const meta = PHASE_META[phase.status];
  const toneColor = {
    success: theme.color.success.DEFAULT,
    primary: theme.color.primary.DEFAULT,
    error: theme.color.error.DEFAULT,
    warning: theme.color.warning.DEFAULT,
    muted: theme.color.text.muted,
  }[meta.tone];
  const external = phase.action.href.startsWith('http');

  return (
    <Card variant="surface" padding="sm">
      <Stack direction="row" gap={3} align="center">
        <span
          aria-hidden="true"
          style={{
            width: 24,
            height: 24,
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: theme.radius.full,
            color: toneColor,
            fontWeight: theme.font.weight.bold,
          }}
        >
          {meta.glyph}
        </span>
        <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
          <Text variant="body" weight="medium">
            {phase.title}
          </Text>
          <Text variant="caption" color="muted">
            {phase.detail}
          </Text>
        </Stack>
        {external ? (
          // A single link-capable element (Button has no href), styled to
          // match the secondary button — no Button-inside-anchor nesting.
          <a
            href={phase.action.href}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: '2.75rem',
              padding: `0 ${theme.spacing[4]}`,
              borderRadius: theme.radius.md,
              border: `1px solid ${theme.color.border.DEFAULT}`,
              color: theme.color.primary.DEFAULT,
              fontSize: theme.font.size.sm,
              fontWeight: theme.font.weight.medium,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {phase.action.label}
          </a>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onNavigate(phase.action.href)}
            style={{ flexShrink: 0 }}
          >
            {phase.action.label}
          </Button>
        )}
      </Stack>
    </Card>
  );
}
