import { Card, Stack, Text, useTheme } from '@themoltnet/design-system';

import { RatioBar } from './charts/ratio-bar.js';
import { HIGH_FRICTION_CAPTION } from './constants.js';
import { formatInteger, formatRateWithCount } from './format.js';
import { StatValue } from './stat-value.js';
import type { TaskActivityProductMetrics } from './types.js';

export interface HurdlesPanelProps {
  hurdles: TaskActivityProductMetrics['hurdles'];
  /** Total tool calls, for the failed-tool-call denominator. */
  toolCallCount: number;
}

interface Outcome {
  kind: 'timeout' | 'abort' | 'failure' | 'cancelled';
  label: string;
  count: number;
}

/**
 * "Where does it struggle" — failed-tool-call rate, the attempt-outcome
 * distribution (timeout / abort / failure / cancelled) as proportional bars,
 * and the high-friction attempt count. The friction definition is stated in a
 * caption; see the API coordination note about surfacing the thresholds from
 * the response instead of hardcoding them here.
 */
export function HurdlesPanel({ hurdles, toolCallCount }: HurdlesPanelProps) {
  const theme = useTheme();

  const outcomes: Outcome[] = [
    { kind: 'failure', label: 'Failed', count: hurdles.failedAttemptCount },
    { kind: 'timeout', label: 'Timed out', count: hurdles.timeoutAttemptCount },
    { kind: 'abort', label: 'Aborted', count: hurdles.abortedAttemptCount },
    {
      kind: 'cancelled',
      label: 'Cancelled',
      count: hurdles.cancelledAttemptCount,
    },
  ];
  const outcomeTotal = outcomes.reduce((acc, o) => acc + o.count, 0);

  return (
    <Card variant="outlined" padding="md">
      <Stack gap={3}>
        <Text variant="overline" style={{ color: theme.color.primary.DEFAULT }}>
          Hurdles
        </Text>

        <Stack direction="row" gap={4} wrap>
          <Stat
            label="Failed tool-call rate"
            value={formatRateWithCount(
              hurdles.failedToolCallRate,
              hurdles.failedToolCallCount,
              toolCallCount,
            )}
          />
          <Stat
            label="Retry attempts"
            value={formatInteger(hurdles.retryAttemptCount)}
          />
          <Stat
            label="High-friction attempts"
            value={formatInteger(hurdles.highFrictionAttemptCount)}
          />
        </Stack>

        <Stack gap={2}>
          <Text variant="caption" color="muted">
            Attempt outcomes
          </Text>
          {outcomeTotal === 0 ? (
            <Text variant="caption" color="muted">
              No failed, timed-out, aborted or cancelled attempts.
            </Text>
          ) : (
            <Stack gap={2}>
              {outcomes.map((o) => (
                <RatioBar
                  key={o.kind}
                  label={o.label}
                  value={o.count / outcomeTotal}
                  valueText={formatInteger(o.count)}
                  tone={o.kind === 'failure' ? 'error' : 'warning'}
                />
              ))}
            </Stack>
          )}
        </Stack>

        <Text variant="caption" color="muted">
          High friction = attempts with {HIGH_FRICTION_CAPTION}.
        </Text>
      </Stack>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap={1} style={{ minWidth: 0 }}>
      <Text variant="caption" color="muted">
        {label}
      </Text>
      <StatValue>{value}</StatValue>
    </Stack>
  );
}
