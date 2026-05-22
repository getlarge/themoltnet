import {
  type DiaryCatalog,
  type DiaryEntry,
  getDiary,
  getDiaryEntryById,
  listDiaries,
  verifyDiaryEntryById,
} from '@moltnet/api-client';

import { getApiClient } from '../api.js';
import { createRestDiaryAdapter } from './adapter.js';
import type { DiarySummary, EntryDetailData, EntryType } from './utils.js';

export const restDiaryAdapter = createRestDiaryAdapter();

export async function fetchDiarySummaries(
  teamId?: string | null,
): Promise<Array<DiarySummary>> {
  const { data } = await listDiaries({
    client: getApiClient(),
    headers: teamId ? { 'x-moltnet-team-id': teamId } : undefined,
  });

  const diaries = data?.items ?? [];

  const summaries = await Promise.all(
    diaries.map(async (diary) => {
      const [entries, tags] = await Promise.all([
        restDiaryAdapter.listEntries({
          diaryId: diary.id,
          limit: 1,
          offset: 0,
        }),
        restDiaryAdapter.listTags(diary.id),
      ]);

      return {
        ...diary,
        entryCount: entries.total ?? 0,
        tagCount: tags.length,
        latestEntryAt: entries.items[0]?.createdAt ?? null,
      } satisfies DiarySummary;
    }),
  );

  return summaries.sort((left, right) => {
    const rightTime = right.latestEntryAt
      ? new Date(right.latestEntryAt).getTime()
      : 0;
    const leftTime = left.latestEntryAt
      ? new Date(left.latestEntryAt).getTime()
      : 0;

    return rightTime - leftTime || left.name.localeCompare(right.name);
  });
}

export async function fetchDiaryDetails(
  diaryId: string,
): Promise<DiaryCatalog> {
  const { data } = await getDiary({
    client: getApiClient(),
    path: { id: diaryId },
  });

  if (!data) throw new Error('Diary not found');
  return data;
}

export async function fetchDiaryEntries(input: {
  diaryId: string;
  limit?: number;
  offset?: number;
  tag?: string | null;
  entryType?: EntryType | null;
}): Promise<{
  items: Array<DiaryEntry>;
  total: number;
  limit: number;
  offset: number;
}> {
  return restDiaryAdapter.listEntries({
    diaryId: input.diaryId,
    limit: input.limit ?? 20,
    offset: input.offset ?? 0,
    tags: input.tag ? [input.tag] : undefined,
    entryType: input.entryType ? [input.entryType] : undefined,
  });
}

export async function fetchDiaryTagCloud(diaryId: string) {
  return restDiaryAdapter.listTags(diaryId);
}

export async function fetchEntryDetail(
  diaryId: string,
  entryId: string,
): Promise<EntryDetailData> {
  const [diaryResponse, entryResponse, verifyResponse] = await Promise.all([
    getDiary({ client: getApiClient(), path: { id: diaryId } }),
    getDiaryEntryById({
      client: getApiClient(),
      path: { entryId },
      query: { expand: 'relations', depth: 2 },
    }),
    verifyDiaryEntryById({ client: getApiClient(), path: { entryId } }),
  ]);

  if (!entryResponse.data) throw new Error('Entry not found');

  return {
    diary: diaryResponse.data ?? null,
    entry: entryResponse.data,
    verification: verifyResponse.data ?? null,
  };
}
