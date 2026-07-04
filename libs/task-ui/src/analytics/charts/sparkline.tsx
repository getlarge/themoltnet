import { useTheme } from '@themoltnet/design-system';

export interface SparklinePoint {
  /** X-axis label (e.g. an ISO day). Used for accessibility, not drawn. */
  label: string;
  /** Y value, or null for a gap (unknown bucket). */
  value: number | null;
}

export interface SparklineProps {
  points: SparklinePoint[];
  /** Fixed Y domain. Defaults to [0, 1] (rates). Pass e.g. [0, max] for counts. */
  domain?: [number, number];
  width?: number;
  height?: number;
  /** Accessible title describing the series. */
  title?: string;
}

/**
 * A minimal null-aware trend line, hand-drawn as inline SVG from theme tokens
 * (no chart dependency). Gaps (null values) break the line into segments and
 * are not plotted. Renders nothing meaningful below two known points.
 */
export function Sparkline({
  points,
  domain = [0, 1],
  width = 160,
  height = 40,
  title,
}: SparklineProps) {
  const theme = useTheme();
  const [min, max] = domain;
  const span = max - min || 1;
  const n = points.length;

  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * width);
  const y = (v: number) => {
    const clamped = Math.min(max, Math.max(min, v));
    return height - ((clamped - min) / span) * height;
  };

  // Break the series into contiguous segments of known points.
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];
  points.forEach((p, i) => {
    if (p.value === null || Number.isNaN(p.value)) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push({ x: x(i), y: y(p.value) });
    }
  });
  if (current.length) segments.push(current);

  const knownCount = segments.reduce((acc, s) => acc + s.length, 0);

  if (knownCount === 0) {
    return (
      <span
        style={{ fontSize: theme.font.size.xs, color: theme.color.text.muted }}
      >
        No trend data
      </span>
    );
  }

  return (
    <svg
      role="img"
      aria-label={title ?? 'Trend'}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {segments.map((seg, si) =>
        seg.length === 1 ? (
          <circle
            key={si}
            cx={seg[0].x}
            cy={seg[0].y}
            r={2}
            fill={theme.color.primary.DEFAULT}
          />
        ) : (
          <polyline
            key={si}
            points={seg.map((pt) => `${pt.x},${pt.y}`).join(' ')}
            fill="none"
            stroke={theme.color.primary.DEFAULT}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ),
      )}
    </svg>
  );
}
