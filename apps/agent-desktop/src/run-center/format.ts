/** Formatting helpers shared by the Run Center views. */

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 1000],
  ['minute', 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
];

/** "2m ago", "just now". Past only — every timestamp here is in the past. */
export function relativeTime(iso: string | null, now: number): string {
  if (!iso) return '—';
  const elapsed = now - Date.parse(iso);
  if (!Number.isFinite(elapsed)) return '—';
  if (elapsed < 45_000) return 'just now';
  let chosen: [Intl.RelativeTimeFormatUnit, number] = UNITS[1];
  for (const unit of UNITS) if (elapsed >= unit[1]) chosen = unit;
  return RELATIVE.format(-Math.round(elapsed / chosen[1]), chosen[0]);
}

/** Elapsed run time as "12m 04s" / "3h 07m". Monospaced at the call site. */
export function duration(startIso: string, endMs: number): string {
  const total = Math.max(0, Math.round((endMs - Date.parse(startIso)) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  return `${minutes}m ${pad(seconds)}s`;
}

export function shortHash(hash: string | null): string {
  if (!hash) return '—';
  return hash.length <= 12 ? hash : `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}

/** Replaces the user's home directory with `~` so paths stay readable. */
export function tildePath(path: string, home = '/Users/you'): string {
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

export function pluralize(count: number, noun: string, plural = `${noun}s`) {
  return `${count} ${count === 1 ? noun : plural}`;
}
