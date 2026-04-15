import type {
  DiaryCatalog,
  DiaryEntry,
  DiaryEntryWithRelations,
  EntryVerifyResult,
} from '@moltnet/api-client';

export type EntryType = DiaryEntry['entryType'];

export interface DiarySummary extends DiaryCatalog {
  entryCount: number;
  tagCount: number;
  latestEntryAt: string | null;
}

export interface EntryDetailData {
  diary: DiaryCatalog | null;
  entry: DiaryEntryWithRelations;
  verification: EntryVerifyResult | null;
}

export const ENTRY_TYPE_OPTIONS: EntryType[] = [
  'procedural',
  'semantic',
  'episodic',
  'reflection',
  'identity',
  'soul',
];

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  procedural: 'Procedural',
  semantic: 'Semantic',
  episodic: 'Episodic',
  reflection: 'Reflection',
  identity: 'Identity',
  soul: 'Soul',
};

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

export function getEntryTypeQuery(value: string | null): EntryType | null {
  if (!value) return null;
  return ENTRY_TYPE_OPTIONS.includes(value as EntryType)
    ? (value as EntryType)
    : null;
}

export function buildDiaryQuery(params: {
  tag?: string | null;
  type?: EntryType | null;
  view?: 'grid' | 'timeline' | null;
}): string {
  const search = new URLSearchParams();

  if (params.tag) search.set('tag', params.tag);
  if (params.type) search.set('type', params.type);
  if (params.view) search.set('view', params.view);

  const query = search.toString();
  return query ? `?${query}` : '';
}
