import { Stack, Text, useTheme } from '@themoltnet/design-system';

import { HIGH_FRICTION_CAPTION, RATE_TONE } from './constants.js';
import {
  formatCount,
  formatDurationMs,
  formatInteger,
  formatPercent,
  formatRatio,
} from './format.js';
import { MetricKpiCard, type MetricTone } from './metric-kpi-card.js';
import type { TaskActivityProductMetrics } from './types.js';

export interface MetricKpiGridProps {
  metrics: TaskActivityProductMetrics;
}

interface Kpi {
  label: string;
  value: string;
  caption?: string;
  hint?: string;
  tone?: MetricTone;
}

interface Pillar {
  title: string;
  kpis: Kpi[];
}

/** Higher rate is better → positive; used for success metrics. */
function goodRateTone(rate: number): MetricTone {
  if (rate >= RATE_TONE.goodPositiveAt) return 'positive';
  if (rate >= RATE_TONE.goodCautionAt) return 'caution';
  return 'negative';
}

/** Higher rate is worse → for failure/friction metrics. */
function badRateTone(rate: number): MetricTone {
  if (rate <= RATE_TONE.badPositiveAt) return 'positive';
  if (rate <= RATE_TONE.badCautionAt) return 'caution';
  return 'negative';
}

export function buildPillars(m: TaskActivityProductMetrics): Pillar[] {
  const s = m.success;
  const p = m.productivity;
  const h = m.hurdles;
  const r = m.roi;

  return [
    {
      title: 'Success',
      kpis: [
        {
          label: 'Accepted output rate',
          value: formatPercent(s.acceptedOutputRate),
          caption: formatCount(s.acceptedTaskCount, s.taskCount),
          hint: 'Share of tasks that produced an accepted output.',
          tone: goodRateTone(s.acceptedOutputRate),
        },
        {
          label: 'First-attempt accepted',
          value: formatPercent(s.firstAttemptAcceptedRate),
          caption: formatCount(s.firstAttemptAcceptedTaskCount, s.taskCount),
          hint: 'Tasks accepted on the very first attempt.',
          tone: goodRateTone(s.firstAttemptAcceptedRate),
        },
        {
          label: 'Retry recovery',
          value: formatPercent(s.retryRecoveryRate),
          caption: formatCount(s.retryRecoveredTaskCount, s.taskCount),
          hint: 'Tasks accepted only after a retry (attempt > 1).',
        },
        {
          label: 'Terminal failure',
          value: formatPercent(s.terminalFailureRate),
          caption: formatCount(s.terminalFailureTaskCount, s.taskCount),
          hint: 'Tasks that failed/cancelled/expired without an accepted output.',
          tone: badRateTone(s.terminalFailureRate),
        },
      ],
    },
    {
      title: 'Productivity',
      kpis: [
        {
          label: 'Accepted / day',
          value: formatRatio(p.acceptedTasksPerDay),
          hint: 'Accepted tasks per day across the window.',
        },
        {
          label: 'Time to accepted',
          value: formatDurationMs(p.medianTimeToAcceptedMs),
          caption: 'median',
          hint: 'Median time from queued to accepted completion.',
        },
        {
          label: 'Attempts / accepted',
          value: formatRatio(p.averageAttemptsPerAcceptedTask),
          hint: 'Average attempts spent per accepted task.',
        },
        {
          label: 'Turns / attempt',
          value: formatRatio(p.medianTurnsPerAttempt),
          caption: 'median',
          hint: 'Median conversation turns per attempt.',
        },
      ],
    },
    {
      title: 'Hurdles',
      kpis: [
        {
          label: 'Failed tool-call rate',
          value: formatPercent(h.failedToolCallRate),
          caption: formatCount(h.failedToolCallCount, m.raw.toolCallCount),
          hint: 'Tool calls that returned an error.',
          tone: badRateTone(h.failedToolCallRate),
        },
        {
          label: 'Retry attempts',
          value: formatInteger(h.retryAttemptCount),
          hint: 'Attempts beyond the first, across all tasks.',
        },
        {
          label: 'High-friction attempts',
          value: formatInteger(h.highFrictionAttemptCount),
          caption: HIGH_FRICTION_CAPTION,
          hint: 'Attempts showing friction: many turns or repeated tool failures.',
        },
        {
          label: 'Timed out / aborted',
          value: `${formatInteger(h.timeoutAttemptCount)} / ${formatInteger(h.abortedAttemptCount)}`,
          hint: 'Attempts that timed out vs were aborted.',
        },
      ],
    },
    {
      title: 'ROI',
      kpis: [
        {
          label: 'Accepted / 1k tokens',
          value: formatRatio(r.acceptedTasksPerThousandTokens),
          hint: 'Accepted tasks delivered per 1,000 tokens spent.',
        },
        {
          label: 'Tokens / accepted',
          value: formatRatio(r.tokensPerAcceptedTask),
          hint: 'Tokens spent per accepted task (lower is cheaper).',
        },
        {
          label: 'Total tokens',
          value: formatInteger(r.totalTokens),
          caption: `${formatInteger(r.totalInputTokens)} in · ${formatInteger(r.totalOutputTokens)} out`,
          hint: 'Total tokens across all attempts in the window.',
        },
        {
          label: 'Retry cost',
          value: formatInteger(r.extraTokensBeforeAcceptance),
          caption: `${formatInteger(r.extraAttemptCount)} extra attempts`,
          hint: 'Tokens spent on attempts before the accepted one.',
        },
      ],
    },
  ];
}

/**
 * The KPI grid: renders a `TaskActivityProductMetrics` as four labelled pillars
 * (Success / Productivity / Hurdles / ROI), each a dense row of KPI cards. The
 * layout itself answers "does it succeed / is it productive / where does it
 * struggle / what's the ROI".
 */
export function MetricKpiGrid({ metrics }: MetricKpiGridProps) {
  const theme = useTheme();
  const pillars = buildPillars(metrics);

  return (
    <Stack gap={5}>
      {pillars.map((pillar) => (
        <Stack key={pillar.title} gap={2}>
          <Text
            variant="overline"
            style={{ color: theme.color.primary.DEFAULT }}
          >
            {pillar.title}
          </Text>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: theme.spacing[3],
            }}
          >
            {pillar.kpis.map((kpi) => (
              <MetricKpiCard key={kpi.label} {...kpi} />
            ))}
          </div>
        </Stack>
      ))}
    </Stack>
  );
}
