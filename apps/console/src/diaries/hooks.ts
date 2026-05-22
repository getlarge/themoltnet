import {
  type DiaryEntry,
  type DiaryList,
  type DiarySearchResult,
  listDiaries,
  listDiaryEntries,
  listDiaryTags,
  searchDiary,
} from '@moltnet/api-client';
import {
  getDiaryEntryByIdOptions,
  getDiaryOptions,
  listDiaryEntriesInfiniteOptions,
  listDiaryTagsOptions,
  verifyDiaryEntryByIdOptions,
} from '@moltnet/api-client/query';
import {
  type DiaryFilterState,
  type TagCloudItem,
  toListEntriesArgs,
  toSearchDiaryArgs,
} from '@moltnet/diary-ui';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { getApiClient } from '../api.js';
import type { DiarySummary, EntryDetailData } from './utils.js';

const DEFAULT_LIMIT = 20;

/**
 * Maximum results returned by the search endpoint in a single call.
 * `DiarySearchResult` is non-paginated (single ranked set); the UI uses this
 * constant to detect when the cap is hit and surface a "refine your query"
 * hint.
 */
export const SEARCH_LIMIT = 50;

function client() {
  return getApiClient();
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}

/**
 * Live-debounced version of the filter state. Only `q` is debounced; the other
 * dimensions (tags, types, weights, view) only change on explicit user actions
 * and don't need debouncing.
 */
export function useDebouncedFilters(
  state: DiaryFilterState,
  delay = 250,
): DiaryFilterState {
  const debouncedQ = useDebouncedValue(state.q, delay);
  return { ...state, q: debouncedQ };
}

export function useDiaryDetails(diaryId: string) {
  return useQuery({
    ...getDiaryOptions({ client: client(), path: { id: diaryId } }),
    staleTime: 30_000,
  });
}

export function useDiaryTags(diaryId: string) {
  return useQuery({
    ...listDiaryTagsOptions({ client: client(), path: { diaryId } }),
    staleTime: 30_000,
    select: (response): TagCloudItem[] => response.tags ?? [],
  });
}

/**
 * Aggregated entries result. `q === ''` uses the paged list endpoint
 * (`GET /diaries/:id/entries`) via useInfiniteQuery; `q !== ''` uses the
 * server-ranked search endpoint (`POST /diaries/search`) via a plain useQuery
 * because DiarySearchResult is not paginated — the server returns a single
 * ranked set, capped by SEARCH_LIMIT.
 */
export interface EntriesResult {
  items: DiaryEntry[];
  total: number;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  /** True only in the list branch; search has no further pages. */
  hasNextPage: boolean;
  fetchNextPage: () => void;
  isFetchingNextPage: boolean;
}

export function useEntries(
  diaryId: string,
  state: DiaryFilterState,
  pageSize: number = DEFAULT_LIMIT,
): EntriesResult {
  // ---- List branch (paginated) ----
  const listArgs = toListEntriesArgs(state, diaryId, {
    limit: pageSize,
    offset: 0,
  });
  const { diaryId: _omit, ...listQuery } = listArgs;
  const listInfinite = useInfiniteQuery({
    ...listDiaryEntriesInfiniteOptions({
      client: client(),
      path: { diaryId },
      query: listQuery,
    }),
    enabled: state.q === '',
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    getNextPageParam: (lastPage: DiaryList, allPages: DiaryList[]) => {
      const loaded = allPages.reduce(
        (sum, page) => sum + (page.items?.length ?? 0),
        0,
      );
      return loaded < (lastPage.total ?? 0) ? loaded : undefined;
    },
  });

  // ---- Search branch (single ranked set) ----
  const searchArgs = toSearchDiaryArgs(state, diaryId, {
    limit: SEARCH_LIMIT,
    offset: 0,
  });
  const searchQuery = useQuery<DiarySearchResult>({
    queryKey: ['searchDiary', diaryId, searchArgs],
    enabled: state.q !== '',
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await searchDiary({
        client: client(),
        body: searchArgs,
        signal,
        throwOnError: false,
      });
      if (error || !data) {
        throw error instanceof Error
          ? error
          : new Error(
              error
                ? `search failed: ${String((error as { title?: string }).title ?? 'unknown')}`
                : 'search failed',
            );
      }
      return data;
    },
  });

  if (state.q === '') {
    const pages = listInfinite.data?.pages ?? [];
    const items = pages.flatMap((page) => page.items ?? []);
    const total = pages.at(-1)?.total ?? 0;
    return {
      items,
      total,
      isLoading: listInfinite.isLoading,
      isFetching: listInfinite.isFetching,
      isError: listInfinite.isError,
      hasNextPage: !!listInfinite.hasNextPage,
      fetchNextPage: () => {
        void listInfinite.fetchNextPage();
      },
      isFetchingNextPage: listInfinite.isFetchingNextPage,
    };
  }

  return {
    items: searchQuery.data?.results ?? [],
    total: searchQuery.data?.total ?? 0,
    isLoading: searchQuery.isLoading,
    isFetching: searchQuery.isFetching,
    isError: searchQuery.isError,
    hasNextPage: false,
    fetchNextPage: () => {},
    isFetchingNextPage: false,
  };
}

export interface EntryDetailQuery {
  data: EntryDetailData | undefined;
  isLoading: boolean;
  isError: boolean;
}

export function useEntryDetail(
  diaryId: string,
  entryId: string,
): EntryDetailQuery {
  const diary = useQuery({
    ...getDiaryOptions({ client: client(), path: { id: diaryId } }),
    staleTime: 30_000,
  });
  const entry = useQuery({
    ...getDiaryEntryByIdOptions({
      client: client(),
      path: { entryId },
      query: { expand: 'relations', depth: 2 },
    }),
    staleTime: 10_000,
  });
  const verification = useQuery({
    ...verifyDiaryEntryByIdOptions({
      client: client(),
      path: { entryId },
    }),
    staleTime: 30_000,
  });

  const data: EntryDetailData | undefined = entry.data
    ? {
        diary: diary.data ?? null,
        entry: entry.data,
        verification: verification.data ?? null,
      }
    : undefined;

  return {
    data,
    isLoading: diary.isLoading || entry.isLoading,
    isError: entry.isError,
  };
}

export function useDiarySummaries(teamId: string | null) {
  return useQuery({
    queryKey: ['diaries', 'summaries', teamId],
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const { data: diariesData } = await listDiaries({
        client: client(),
        headers: teamId ? { 'x-moltnet-team-id': teamId } : undefined,
        signal,
      });
      const diaries = diariesData?.items ?? [];

      const summaries = await Promise.all(
        diaries.map(async (diary) => {
          const [entriesRes, tagsRes] = await Promise.all([
            listDiaryEntries({
              client: client(),
              path: { diaryId: diary.id },
              query: { limit: 1, offset: 0 },
              signal,
            }),
            listDiaryTags({
              client: client(),
              path: { diaryId: diary.id },
              signal,
            }),
          ]);
          return {
            ...diary,
            entryCount: entriesRes.data?.total ?? 0,
            tagCount: tagsRes.data?.total ?? 0,
            latestEntryAt: entriesRes.data?.items[0]?.createdAt ?? null,
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
    },
  });
}
