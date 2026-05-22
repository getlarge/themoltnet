export function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'No entries yet';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSeconds = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSeconds < 60) return 'just now';
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  if (diffSeconds < 604800) return `${Math.floor(diffSeconds / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function estimateTokenCount(content: string): number {
  return Math.max(1, Math.round(content.length / 4));
}
