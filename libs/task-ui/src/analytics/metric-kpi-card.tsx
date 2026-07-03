import { Card, Text, Tooltip, useTheme } from '@themoltnet/design-system';
import type { ReactNode } from 'react';

import { UNKNOWN } from './format.js';

export type MetricTone = 'neutral' | 'positive' | 'caution' | 'negative';

export interface MetricKpiCardProps {
  label: string;
  /** Primary formatted value (already formatted; may be the UNKNOWN marker). */
  value: string;
  /** Secondary caption, e.g. "41/50" or "of 128 attempts". */
  caption?: string;
  /** One-line explanation shown on hover — what the metric means. */
  hint?: string;
  /** Tone tints the value; use to signal good/bad without a full chart. */
  tone?: MetricTone;
  /** Optional in-card visual (e.g. a RatioBar or Sparkline). */
  children?: ReactNode;
}

function toneColor(
  tone: MetricTone,
  theme: ReturnType<typeof useTheme>,
): string {
  switch (tone) {
    case 'positive':
      return theme.color.success.DEFAULT;
    case 'caution':
      return theme.color.warning.DEFAULT;
    case 'negative':
      return theme.color.error.DEFAULT;
    default:
      return theme.color.text.DEFAULT;
  }
}

/**
 * A compact KPI card: label, large value, optional caption + in-card visual.
 * When `value` is the unknown marker the value renders muted so it reads as
 * "not enough data" rather than a real number.
 */
export function MetricKpiCard({
  label,
  value,
  caption,
  hint,
  tone = 'neutral',
  children,
}: MetricKpiCardProps) {
  const theme = useTheme();
  const isUnknown = value === UNKNOWN;
  const valueColor = isUnknown ? theme.color.text.muted : toneColor(tone, theme);

  const labelEl = (
    <Text
      variant="overline"
      color="muted"
      style={{
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </Text>
  );

  return (
    <Card
      variant="outlined"
      padding="sm"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing[1],
        minWidth: 0,
      }}
    >
      {hint ? <Tooltip content={hint}>{labelEl}</Tooltip> : labelEl}

      <span
        aria-label={isUnknown ? `${label}: unknown` : undefined}
        style={{
          fontSize: theme.font.size['2xl'],
          fontWeight: theme.font.weight.semibold,
          color: valueColor,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.1,
        }}
      >
        {value}
      </span>

      {caption ? (
        <Text
          variant="caption"
          color="muted"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {caption}
        </Text>
      ) : null}

      {children}
    </Card>
  );
}
