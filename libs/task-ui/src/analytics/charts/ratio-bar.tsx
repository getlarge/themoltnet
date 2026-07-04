import { useTheme } from '@themoltnet/design-system';

import { formatPercent, UNKNOWN } from '../format.js';

export interface RatioBarProps {
  /** Fill fraction in [0, 1], or null for an unknown value. */
  value: number | null;
  /** Optional label rendered above the track. */
  label?: string;
  /**
   * Signal tone for the fill. `neutral` uses the primary colour; the others map
   * to the design-system signal palette. Defaults to `neutral`.
   */
  tone?: 'neutral' | 'success' | 'warning' | 'error';
  /** Text shown next to the label; defaults to the value as a percent. */
  valueText?: string;
}

/**
 * A single horizontal ratio/meter bar built from theme tokens (no chart dep).
 * A null value renders an empty track with the unknown marker.
 */
export function RatioBar({
  value,
  label,
  tone = 'neutral',
  valueText,
}: RatioBarProps) {
  const theme = useTheme();
  const known = value !== null && !Number.isNaN(value);
  const fraction = known ? Math.min(1, Math.max(0, value)) : 0;
  const fillColor =
    tone === 'neutral'
      ? theme.color.primary.DEFAULT
      : theme.color[tone].DEFAULT;
  const display = valueText ?? (known ? formatPercent(value) : UNKNOWN);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing[1],
      }}
    >
      {(label || display) && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: theme.spacing[2],
            fontSize: theme.font.size.xs,
          }}
        >
          {label ? (
            <span
              style={{
                color: theme.color.text.secondary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {label}
            </span>
          ) : (
            <span />
          )}
          <span
            style={{
              color: known ? theme.color.text.DEFAULT : theme.color.text.muted,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            {display}
          </span>
        </div>
      )}
      <div
        role="presentation"
        aria-hidden
        data-testid="ratio-bar-track"
        style={{
          height: theme.spacing[1.5],
          borderRadius: theme.radius.full,
          background: theme.color.bg.overlay,
          overflow: 'hidden',
        }}
      >
        <div
          data-testid="ratio-bar-fill"
          style={{
            height: '100%',
            width: `${fraction * 100}%`,
            background: fillColor,
            opacity: known ? 1 : 0,
            transition: theme.transition.normal,
          }}
        />
      </div>
    </div>
  );
}
