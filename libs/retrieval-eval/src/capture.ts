import { createHash } from 'node:crypto';

export interface SourceEntry {
  id: string;
  title: string | null;
  content: string;
  tags: string[] | null;
  entryType: string;
  createdAt: string;
  importance: number;
}
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

/** Recovered recipe: coverage-balanced, not a population-weighted sample. */
export function sampleEntries(
  entries: SourceEntry[],
  size: number,
  seed: string,
): SourceEntry[] {
  if (!Number.isSafeInteger(size) || size < 1 || !seed.trim())
    throw new Error('Invalid sampling parameters');
  if (new Set(entries.map((e) => e.id)).size !== entries.length)
    throw new Error('Duplicate source IDs');
  const buckets = new Map<string, SourceEntry[]>();
  const ordered = [...entries].sort((a, b) =>
    digest(`${seed}:${a.id}`).localeCompare(digest(`${seed}:${b.id}`)),
  );
  for (const entry of ordered) {
    const date = new Date(entry.createdAt);
    if (!Number.isFinite(date.getTime()))
      throw new Error('Invalid source date');
    const scope =
      (entry.tags ?? []).filter((tag) => tag.startsWith('scope:')).sort()[0] ??
      'unscoped';
    const key = `${entry.entryType}:${scope}:${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(entry);
    buckets.set(key, bucket);
  }
  const queues = [...buckets]
    .sort(([a], [b]) =>
      digest(`${seed}:${a}`).localeCompare(digest(`${seed}:${b}`)),
    )
    .map(([, entries]) => entries);
  const result: SourceEntry[] = [];
  for (let index = 0; result.length < Math.min(size, entries.length); index++) {
    for (const queue of queues) {
      if (queue[index]) result.push(queue[index]);
      if (result.length === Math.min(size, entries.length)) break;
    }
  }
  return result;
}
