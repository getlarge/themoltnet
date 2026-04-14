/**
 * Diary entry MCP tool input schemas.
 *
 * Covers: entries_create/get/list/search/update/delete/verify,
 * diary_tags, and reflect.
 */

import type {
  CreateDiaryEntryData,
  CreateDiaryEntryResponses,
  DeleteDiaryEntryByIdData,
  DeleteDiaryEntryByIdResponses,
  EntryType,
  GetDiaryEntryByIdData,
  GetDiaryEntryByIdResponses,
  ListDiaryEntriesData,
  ListDiaryEntriesResponses,
  ListDiaryTagsResponses,
  ReflectDiaryData,
  ReflectDiaryResponses,
  SearchDiaryData,
  SearchDiaryResponses,
  UpdateDiaryEntryByIdData,
  UpdateDiaryEntryByIdResponses,
  VerifyDiaryEntryByIdData,
  VerifyDiaryEntryByIdResponses,
} from '@moltnet/api-client';
import { EntryTypeSchema } from '@moltnet/models';
import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

import type {
  AssertOutputMatchesApi,
  AssertSchemaToApi,
  BodyOf,
  PathOf,
  QueryOf,
  ResponseOf,
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

// --- Output schemas ---

const EntryTypeLiteralSchema = Type.Union([
  Type.Literal('episodic'),
  Type.Literal('semantic'),
  Type.Literal('procedural'),
  Type.Literal('reflection'),
  Type.Literal('identity'),
  Type.Literal('soul'),
]);

const DiaryEntrySchema = Type.Object({
  id: Type.String(),
  diaryId: Type.String(),
  title: Type.Union([Type.String(), Type.Null()]),
  content: Type.String(),
  tags: Type.Union([Type.Array(Type.String()), Type.Null()]),
  injectionRisk: Type.Boolean(),
  importance: Type.Number(),
  accessCount: Type.Number(),
  lastAccessedAt: Type.Union([Type.String(), Type.Null()]),
  entryType: EntryTypeLiteralSchema,
  contentHash: Type.Union([Type.String(), Type.Null()]),
  contentSignature: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

const RelationTypeSchema = Type.Union([
  Type.Literal('supersedes'),
  Type.Literal('elaborates'),
  Type.Literal('contradicts'),
  Type.Literal('supports'),
  Type.Literal('caused_by'),
  Type.Literal('references'),
]);

const RelationStatusSchema = Type.Union([
  Type.Literal('proposed'),
  Type.Literal('accepted'),
  Type.Literal('rejected'),
]);

const EntryRelationWithDepthSchema = Type.Object({
  id: Type.String(),
  sourceId: Type.String(),
  targetId: Type.String(),
  relation: RelationTypeSchema,
  status: RelationStatusSchema,
  sourceCidSnapshot: Type.Union([Type.String(), Type.Null()]),
  targetCidSnapshot: Type.Union([Type.String(), Type.Null()]),
  workflowId: Type.Union([Type.String(), Type.Null()]),
  confidence: Type.Union([Type.Number(), Type.Null()]),
  similarity: Type.Union([Type.Number(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  depth: Type.Number(),
  parentRelationId: Type.Union([Type.String(), Type.Null()]),
});

const ExpandedRelationsSchema = Type.Object({
  requestedDepth: Type.Number(),
  maxDepth: Type.Number(),
  items: Type.Array(EntryRelationWithDepthSchema),
});

export const EntryCreateOutputSchema = DiaryEntrySchema;

export const EntryGetOutputSchema = Type.Object({
  id: Type.String(),
  diaryId: Type.String(),
  title: Type.Union([Type.String(), Type.Null()]),
  content: Type.String(),
  tags: Type.Union([Type.Array(Type.String()), Type.Null()]),
  injectionRisk: Type.Boolean(),
  importance: Type.Number(),
  accessCount: Type.Number(),
  lastAccessedAt: Type.Union([Type.String(), Type.Null()]),
  entryType: EntryTypeLiteralSchema,
  contentHash: Type.Union([Type.String(), Type.Null()]),
  contentSignature: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  relations: Type.Optional(ExpandedRelationsSchema),
});

export const EntryListOutputSchema = Type.Object({
  items: Type.Array(DiaryEntrySchema),
  total: Type.Number(),
  limit: Type.Number(),
  offset: Type.Number(),
});

export const EntryUpdateOutputSchema = DiaryEntrySchema;

export const EntryDeleteOutputSchema = Type.Object({
  success: Type.Boolean(),
});

export const EntrySearchOutputSchema = Type.Object({
  results: Type.Array(DiaryEntrySchema),
  total: Type.Number(),
});

export const EntryVerifyOutputSchema = Type.Object({
  signed: Type.Boolean(),
  hashMatches: Type.Boolean(),
  signatureValid: Type.Boolean(),
  valid: Type.Boolean(),
  contentHash: Type.Union([Type.String(), Type.Null()]),
  agentFingerprint: Type.Union([Type.String(), Type.Null()]),
});

export const DiaryTagsOutputSchema = Type.Object({
  tags: Type.Array(
    Type.Object({
      tag: Type.String(),
      count: Type.Number(),
    }),
  ),
  total: Type.Number(),
});

export const ReflectOutputSchema = Type.Object({
  entries: Type.Array(
    Type.Object({
      id: Type.String(),
      content: Type.String(),
      tags: Type.Union([Type.Array(Type.String()), Type.Null()]),
      importance: Type.Number(),
      entryType: EntryTypeLiteralSchema,
      createdAt: Type.String(),
    }),
  ),
  totalEntries: Type.Number(),
  periodDays: Type.Number(),
  generatedAt: Type.String(),
});

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

type _EntryCreateOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof EntryCreateOutputSchema>,
  ResponseOf<CreateDiaryEntryResponses>
>;
type _EntryGetOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof EntryGetOutputSchema>,
  ResponseOf<GetDiaryEntryByIdResponses>
>;
type _EntryListOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof EntryListOutputSchema>,
  ResponseOf<ListDiaryEntriesResponses>
>;
type _EntryUpdateOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof EntryUpdateOutputSchema>,
  ResponseOf<UpdateDiaryEntryByIdResponses>
>;
type _EntryDeleteOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof EntryDeleteOutputSchema>,
  ResponseOf<DeleteDiaryEntryByIdResponses>
>;
type _EntrySearchOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof EntrySearchOutputSchema>,
  ResponseOf<SearchDiaryResponses>
>;
type _EntryVerifyOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof EntryVerifyOutputSchema>,
  ResponseOf<VerifyDiaryEntryByIdResponses>
>;
type _DiaryTagsOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof DiaryTagsOutputSchema>,
  ResponseOf<ListDiaryTagsResponses>
>;
type _ReflectOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof ReflectOutputSchema>,
  ResponseOf<ReflectDiaryResponses>
>;
