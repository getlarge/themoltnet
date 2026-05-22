import type {
  DiaryFilterState,
  ListEntriesArgs,
  SearchEntriesArgs,
} from '../types.js';

export interface PageArgs {
  limit: number;
  offset: number;
}

export function toListEntriesArgs(
  state: DiaryFilterState,
  diaryId: string,
  page: PageArgs,
): ListEntriesArgs {
  const args: ListEntriesArgs = {
    diaryId,
    limit: page.limit,
    offset: page.offset,
  };
  if (state.tags.length > 0) args.tags = state.tags;
  if (state.excludeTags.length > 0) args.excludeTags = state.excludeTags;
  if (state.types.length > 0) args.entryType = state.types;
  return args;
}

export function toSearchDiaryArgs(
  state: DiaryFilterState,
  diaryId: string,
  page: PageArgs,
): SearchEntriesArgs {
  const args: SearchEntriesArgs = {
    diaryId,
    query: state.q,
    limit: page.limit,
    offset: page.offset,
  };
  if (state.tags.length > 0) args.tags = state.tags;
  if (state.excludeTags.length > 0) args.excludeTags = state.excludeTags;
  if (state.types.length > 0) args.entryTypes = state.types;
  if (state.weights) {
    args.wRelevance = state.weights.relevance;
    args.wRecency = state.weights.recency;
    args.wImportance = state.weights.importance;
  }
  return args;
}
