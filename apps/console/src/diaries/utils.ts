import type { DiaryCatalog } from '@moltnet/api-client';
import {
  ENTRY_TYPE_LABELS,
  ENTRY_TYPES,
  type EntryDetailData,
  type EntryType,
  estimateTokenCount,
  formatDateTime,
  formatRelativeTime,
} from '@moltnet/diary-ui';

export type { EntryDetailData, EntryType };
export {
  ENTRY_TYPE_LABELS,
  ENTRY_TYPES,
  estimateTokenCount,
  formatDateTime,
  formatRelativeTime,
};

export const ENTRY_TYPE_OPTIONS: EntryType[] = [...ENTRY_TYPES];

export interface DiarySummary extends DiaryCatalog {
  entryCount: number;
  tagCount: number;
  latestEntryAt: string | null;
}

export function getEntryTypeQuery(value: string | null): EntryType | null {
  if (!value) return null;
  return (ENTRY_TYPES as readonly string[]).includes(value)
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
