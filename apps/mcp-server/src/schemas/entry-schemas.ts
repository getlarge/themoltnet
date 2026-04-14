/**
 * Diary entry MCP tool input schemas.
 *
 * Covers: entries_create/get/list/search/update/delete/verify,
 * diary_tags, and reflect.
 */

import type {
  CreateDiaryEntryData,
  DeleteDiaryEntryByIdData,
  EntryType,
  GetDiaryEntryByIdData,
  ListDiaryEntriesData,
  ReflectDiaryData,
  SearchDiaryData,
  UpdateDiaryEntryByIdData,
  VerifyDiaryEntryByIdData,
} from '@moltnet/api-client';
import { EntryTypeSchema } from '@moltnet/models';
import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

import type {
  AssertSchemaToApi,
  BodyOf,
  PathOf,
  QueryOf,
  SnakeCasedProperties,
  SnakePick,
} from './common.js';

export const EntryCreateSchema = Type.Object({
  diary_id: Type.String({
    description: 'Diary identifier (UUID).',
  }),
  content: Type.String({ description: 'The memory content (1-10000 chars)' }),
  title: Type.Optional(
    Type.String({ description: 'Title for this entry (max 255 chars)' }),
  ),
  tags: Type.Optional(
    Type.Array(Type.String(), { description: 'Tags for categorization' }),
  ),
  importance: Type.Optional(
    Type.Number({
      description:
        'How important is this memory? 1=trivial, 10=critical. Default 5.',
      minimum: 1,
      maximum: 10,
    }),
  ),
  entry_type: Type.Optional(
    Type.Union([...EntryTypeSchema.anyOf], {
      description: 'Memory type. Default semantic.',
    }),
  ),
  signing_request_id: Type.Optional(
    Type.String({
      description:
        'ID of a completed signing request. The server computes the CID from entry fields and verifies it matches the signing request message.',
    }),
  ),
});
type CreateEntryBody = BodyOf<CreateDiaryEntryData>;
export type EntryCreateInput = SnakeCasedProperties<CreateEntryBody> & {
  diary_id: PathOf<CreateDiaryEntryData>['diaryId'];
  signing_request_id?: string;
};

export const EntryGetSchema = Type.Object({
  diary_id: Type.Optional(
    Type.String({
      description:
        'Deprecated. Diary identifier (UUID). No longer required for by-ID routes.',
    }),
  ),
  entry_id: Type.String({ description: 'The entry ID' }),
  expand_relations: Type.Optional(
    Type.Boolean({
      description:
        'When true, includes inline relation graph up to `depth` hops.',
    }),
  ),
  depth: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 3,
      description:
        'Traversal depth for relation expansion (1-3). Only used when expand_relations=true. Default: 1.',
    }),
  ),
});
export type EntryGetInput = {
  diary_id?: string;
  entry_id: PathOf<GetDiaryEntryByIdData>['entryId'];
  expand_relations?: boolean;
  depth?: number;
};

export const EntryListSchema = Type.Object({
  diary_id: Type.String({
    description: 'Diary identifier (UUID).',
  }),
  limit: Type.Optional(
    Type.Number({ description: 'Max results (default 20)' }),
  ),
  offset: Type.Optional(Type.Number({ description: 'Offset for pagination' })),
  tags: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Filter by tags (entry must have ALL specified tags)',
    }),
  ),
  exclude_tags: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Exclude entries containing ANY specified tags',
    }),
  ),
});
type ListDiaryQuery = QueryOf<ListDiaryEntriesData>;
export type EntryListInput = Pick<ListDiaryQuery, 'limit' | 'offset'> & {
  diary_id: PathOf<ListDiaryEntriesData>['diaryId'];
  tags?: string[];
  exclude_tags?: string[];
};

export const DiaryTagsSchema = Type.Object({
  diary_id: Type.String({
    description: 'Diary identifier (UUID).',
  }),
  prefix: Type.Optional(
    Type.String({
      description: 'Filter to tags starting with this prefix (e.g. "source:")',
    }),
  ),
  min_count: Type.Optional(
    Type.Integer({
      description: 'Exclude tags with fewer than this many entries',
      minimum: 1,
    }),
  ),
  entry_types: Type.Optional(
    Type.Array(Type.Union([...EntryTypeSchema.anyOf]), {
      description: 'Scope tag counts to specific entry types',
    }),
  ),
});
export type DiaryTagsInput = Static<typeof DiaryTagsSchema>;

export const EntrySearchSchema = Type.Object({
  diary_id: Type.Optional(
    Type.String({
      description:
        'Diary identifier (UUID). Omit to search across all diaries.',
    }),
  ),
  query: Type.String({
    description:
      'Search query — natural language or websearch_to_tsquery syntax. ' +
      'Examples: `deploy production` (OR match), `"npm audit"` (phrase), ' +
      '`deploy -staging` (exclude term), `"security vulnerability" +audit` (phrase + required).',
  }),
  limit: Type.Optional(
    Type.Number({ description: 'Max results (default 10)' }),
  ),
  tags: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Filter by tags (entry must have ALL specified tags)',
    }),
  ),
  w_relevance: Type.Optional(
    Type.Number({
      description: 'Weight for text/semantic relevance. Default 1.0',
    }),
  ),
  w_recency: Type.Optional(
    Type.Number({
      description:
        'Weight for recency. 0=ignore time, 0.3=moderate bias. Default 0.0',
    }),
  ),
  w_importance: Type.Optional(
    Type.Number({
      description:
        'Weight for entry importance. 0=ignore, 0.2=moderate. Default 0.0',
    }),
  ),
  entry_types: Type.Optional(
    Type.Array(Type.Union([...EntryTypeSchema.anyOf]), {
      description: 'Filter by memory type',
    }),
  ),
  exclude_superseded: Type.Optional(
    Type.Boolean({
      description: 'Skip entries that have been superseded. Default false',
    }),
  ),
});
type SearchDiaryBody = NonNullable<SearchDiaryData['body']>;
type EntrySearchFields = SnakePick<
  SearchDiaryBody,
  | 'query'
  | 'limit'
  | 'tags'
  | 'excludeTags'
  | 'wRelevance'
  | 'wRecency'
  | 'wImportance'
  | 'entryTypes'
  | 'excludeSuperseded'
>;
export type EntrySearchInput = EntrySearchFields & {
  diary_id?: SearchDiaryBody['diaryId'];
  query: NonNullable<SearchDiaryBody['query']>;
};

export const EntryUpdateSchema = Type.Object({
  diary_id: Type.Optional(
    Type.String({
      description:
        'Deprecated. Diary identifier (UUID). No longer required for by-ID routes.',
    }),
  ),
  entry_id: Type.String({ description: 'The entry ID' }),
  content: Type.Optional(Type.String({ description: 'New content' })),
  tags: Type.Optional(Type.Array(Type.String(), { description: 'New tags' })),
  title: Type.Optional(Type.String({ description: 'New title' })),
  importance: Type.Optional(
    Type.Number({
      description: 'New importance (1-10)',
      minimum: 1,
      maximum: 10,
    }),
  ),
  entry_type: Type.Optional(
    Type.Union([...EntryTypeSchema.anyOf], { description: 'New memory type' }),
  ),
});
type UpdateDiaryBody = NonNullable<UpdateDiaryEntryByIdData['body']>;
export type EntryUpdateInput = SnakeCasedProperties<UpdateDiaryBody> & {
  diary_id?: string;
  entry_id: PathOf<UpdateDiaryEntryByIdData>['entryId'];
};

export const EntryVerifySchema = Type.Object({
  diary_id: Type.Optional(
    Type.String({
      description:
        'Deprecated. Diary identifier (UUID). No longer required for by-ID routes.',
    }),
  ),
  entry_id: Type.String({ description: 'The entry ID to verify' }),
});
export type EntryVerifyInput = {
  diary_id?: string;
  entry_id: PathOf<VerifyDiaryEntryByIdData>['entryId'];
};

export const EntryDeleteSchema = Type.Object({
  diary_id: Type.Optional(
    Type.String({
      description:
        'Deprecated. Diary identifier (UUID). No longer required for by-ID routes.',
    }),
  ),
  entry_id: Type.String({ description: 'The entry ID to delete' }),
});
export type EntryDeleteInput = {
  diary_id?: string;
  entry_id: PathOf<DeleteDiaryEntryByIdData>['entryId'];
};

export const ReflectSchema = Type.Object({
  diary_id: Type.String({
    description: 'Diary identifier (UUID).',
  }),
  days: Type.Optional(
    Type.Number({
      description: 'Only include entries from the last N days (default 7)',
    }),
  ),
  max_entries: Type.Optional(
    Type.Number({ description: 'Max entries to include (default 50)' }),
  ),
  entry_types: Type.Optional(
    Type.Array(Type.Union([...EntryTypeSchema.anyOf]), {
      description: 'Filter by memory type',
    }),
  ),
});
type ReflectDiaryQuery = QueryOf<ReflectDiaryData>;
export type ReflectInput = {
  diary_id: ReflectDiaryQuery['diaryId'];
  days?: ReflectDiaryQuery['days'];
  max_entries?: ReflectDiaryQuery['maxEntries'];
  entry_types?: EntryType[];
};

// --- Compile-time drift checks ---

type _EntryCreateInputMatchesSchema = AssertSchemaToApi<
  Static<typeof EntryCreateSchema>,
  EntryCreateInput
>;
type _EntryGetInputMatchesSchema = AssertSchemaToApi<
  Static<typeof EntryGetSchema>,
  EntryGetInput
>;
type _EntryListInputMatchesSchema = AssertSchemaToApi<
  Static<typeof EntryListSchema>,
  EntryListInput
>;
type _EntrySearchInputMatchesSchema = AssertSchemaToApi<
  Static<typeof EntrySearchSchema>,
  EntrySearchInput
>;
type _EntryUpdateInputMatchesSchema = AssertSchemaToApi<
  Static<typeof EntryUpdateSchema>,
  EntryUpdateInput
>;
type _EntryDeleteInputMatchesSchema = AssertSchemaToApi<
  Static<typeof EntryDeleteSchema>,
  EntryDeleteInput
>;
type _EntryVerifyInputMatchesSchema = AssertSchemaToApi<
  Static<typeof EntryVerifySchema>,
  EntryVerifyInput
>;
type _ReflectInputMatchesSchema = AssertSchemaToApi<
  Static<typeof ReflectSchema>,
  ReflectInput
>;
