import {
  type DiaryList,
  type DiarySearchResult,
  listDiaryEntries,
  listDiaryTags,
  searchDiary,
} from '@moltnet/api-client';
import type {
  DiaryDataAdapter,
  ListEntriesArgs,
  SearchEntriesArgs,
  TagCloudItem,
} from '@moltnet/diary-ui';

import { getApiClient } from '../api.js';

export function createRestDiaryAdapter(): DiaryDataAdapter {
  return {
    async listEntries(
      args: ListEntriesArgs,
      signal?: AbortSignal,
    ): Promise<DiaryList> {
      const { diaryId, ...query } = args;
      const { data } = await listDiaryEntries({
        client: getApiClient(),
        path: { diaryId },
        query,
        signal,
      });
      return (
        data ?? {
          items: [],
          total: 0,
          limit: query.limit ?? 20,
          offset: query.offset ?? 0,
        }
      );
    },
    async searchEntries(
      args: SearchEntriesArgs,
      signal?: AbortSignal,
    ): Promise<DiarySearchResult> {
      const { data } = await searchDiary({
        client: getApiClient(),
        body: args,
        signal,
      });
      if (!data) throw new Error('search failed');
      return data;
    },
    async listTags(
      diaryId: string,
      signal?: AbortSignal,
    ): Promise<TagCloudItem[]> {
      const { data } = await listDiaryTags({
        client: getApiClient(),
        path: { diaryId },
        signal,
      });
      return data?.tags ?? [];
    },
  };
}
