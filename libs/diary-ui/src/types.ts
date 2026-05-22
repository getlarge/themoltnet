import type {
  DiaryCatalog,
  DiaryEntry,
  DiaryEntryWithRelations,
  DiaryList,
  DiarySearchResult,
  EntryVerifyResult,
  ListDiaryEntriesData,
  SearchDiaryData,
} from '@moltnet/api-client';

export type EntryType = DiaryEntry['entryType'];

export const ENTRY_TYPES: readonly EntryType[] = [
  'procedural',
  'semantic',
  'episodic',
  'reflection',
  'identity',
  'soul',
] as const;

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  procedural: 'Procedural',
  semantic: 'Semantic',
  episodic: 'Episodic',
  reflection: 'Reflection',
  identity: 'Identity',
  soul: 'Soul',
};

export interface TagCloudItem {
  tag: string;
  count: number;
}

export interface DiaryFilterWeights {
  relevance: number;
  recency: number;
  importance: number;
}

export const DEFAULT_WEIGHTS: DiaryFilterWeights = {
  relevance: 1.0,
  recency: 0.5,
  importance: 0.5,
};

export interface DiaryFilterState {
  q: string;
  tags: string[];
  excludeTags: string[];
  types: EntryType[];
  view: 'grid' | 'timeline';
  weights: DiaryFilterWeights | null;
}

export const EMPTY_FILTER_STATE: DiaryFilterState = {
  q: '',
  tags: [],
  excludeTags: [],
  types: [],
  view: 'grid',
  weights: null,
};

export type ListEntriesArgs = NonNullable<ListDiaryEntriesData['query']> & {
  diaryId: string;
};

export type SearchEntriesArgs = NonNullable<SearchDiaryData['body']>;

export interface DiaryDataAdapter {
  listEntries(args: ListEntriesArgs, signal?: AbortSignal): Promise<DiaryList>;
  searchEntries(
    args: SearchEntriesArgs,
    signal?: AbortSignal,
  ): Promise<DiarySearchResult>;
  listTags(diaryId: string, signal?: AbortSignal): Promise<TagCloudItem[]>;
}

export type {
  DiaryCatalog,
  DiaryEntry,
  DiaryEntryWithRelations,
  DiaryList,
  DiarySearchResult,
  EntryVerifyResult,
};
