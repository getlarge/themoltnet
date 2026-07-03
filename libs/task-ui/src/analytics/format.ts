// Formatting helpers for analytics surfaces.
//
// Two rules the whole surface depends on:
//  - Rates are always in [0, 1] and are NEVER unknown — 0 renders as "0%".
//  - Ratios / medians are nullable; null renders as UNKNOWN ("—"), which must
//    read as "not enough data", never as a real zero.

/** The marker shown for a null (unknown) ratio/median metric. */
export const UNKNOWN = '—';

/** Format a [0, 1] rate as a percent. Keeps one decimal only when it matters. */
export function formatPercent(rate: number): string {
  const pct = rate * 100;
  const rounded = Math.round(pct * 10) / 10;
  // Show a decimal only when the value isn't a whole percent.
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text}%`;
}

/** "n/d" — the raw counts behind a rate. */
export function formatCount(numerator: number, denominator: number): string {
  return `${formatInteger(numerator)}/${formatInteger(denominator)}`;
}

/** "82% (41/50)" — a rate with its honest counts. */
export function formatRateWithCount(
  rate: number,
  numerator: number,
  denominator: number,
): string {
  return `${formatPercent(rate)} (${formatCount(numerator, denominator)})`;
}

/** Integer with thousands separators. */
export function formatInteger(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/**
 * A nullable ratio/median number. Trims trailing zeros, caps at 2 decimals, and
 * renders null as UNKNOWN. An optional unit suffix is appended only when known.
 */
export function formatRatio(value: number | null, unit = ''): string {
  if (value === null || Number.isNaN(value)) return UNKNOWN;
  const rounded = Math.round(value * 100) / 100;
  return `${String(rounded)}${unit}`;
}

/** A nullable duration in milliseconds, rendered at a human granularity. */
export function formatDurationMs(ms: number | null): string {
  if (ms === null || Number.isNaN(ms)) return UNKNOWN;
  if (ms < 1000) return `${Math.round(ms)}ms`;

  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    const s = Math.round(totalSeconds * 10) / 10;
    return `${s}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const s = Math.round(totalSeconds - totalMinutes * 60);
    return `${totalMinutes}m ${s}s`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const m = totalMinutes - hours * 60;
  return `${hours}h ${m}m`;
}
