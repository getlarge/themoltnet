import type { DiaryCatalog } from '@moltnet/api-client';
import {
  type EntryDetailData,
  type EntryType,
  formatRelativeTime,
} from '@moltnet/diary-ui';

export type { EntryDetailData, EntryType };
export { formatRelativeTime };

export interface DiarySummary extends DiaryCatalog {
  entryCount: number;
  tagCount: number;
  latestEntryAt: string | null;
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
