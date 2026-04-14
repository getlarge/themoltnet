import {
  type DiaryCatalog,
  type DiaryEntry,
  getDiary,
  getDiaryEntryById,
  listDiaries,
  listDiaryEntries,
  listDiaryTags,
  verifyDiaryEntryById,
} from '@moltnet/api-client';

import { getApiClient } from '../api.js';
import type { DiarySummary, EntryDetailData, EntryType } from './utils.js';

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
      const [entriesResponse, tagsResponse] = await Promise.all([
        listDiaryEntries({
          client: getApiClient(),
          path: { diaryId: diary.id },
          query: { limit: 1, offset: 0 },
        }),
        listDiaryTags({
          client: getApiClient(),
          path: { diaryId: diary.id },
        }),
      ]);

      return {
        ...diary,
        entryCount: entriesResponse.data?.total ?? 0,
        tagCount: tagsResponse.data?.total ?? 0,
        latestEntryAt: entriesResponse.data?.items[0]?.createdAt ?? null,
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
  const { data } = await listDiaryEntries({
    client: getApiClient(),
    path: { diaryId: input.diaryId },
    query: {
      limit: input.limit ?? 20,
      offset: input.offset ?? 0,
      tags: input.tag ?? undefined,
      entryType: input.entryType ?? undefined,
    },
  });

  if (!data) {
    return {
      items: [],
      total: 0,
      limit: input.limit ?? 20,
      offset: input.offset ?? 0,
    };
  }

  return data;
}

export async function fetchDiaryTagCloud(diaryId: string) {
  const { data } = await listDiaryTags({
    client: getApiClient(),
    path: { diaryId },
  });

  return data?.tags ?? [];
}

export async function fetchEntryDetail(
  diaryId: string,
  entryId: string,
): Promise<EntryDetailData> {
  const [diaryResponse, entryResponse, verifyResponse] = await Promise.all([
    getDiary({
      client: getApiClient(),
      path: { id: diaryId },
    }),
    getDiaryEntryById({
      client: getApiClient(),
      path: { entryId },
      query: { expand: 'relations', depth: 2 },
    }),
    verifyDiaryEntryById({
      client: getApiClient(),
      path: { entryId },
    }),
  ]);

  if (!entryResponse.data) throw new Error('Entry not found');

  return {
    diary: diaryResponse.data ?? null,
    entry: entryResponse.data,
    verification: verifyResponse.data ?? null,
  };
}
