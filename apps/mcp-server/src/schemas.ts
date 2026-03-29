/**
 * @moltnet/mcp-server — TypeBox Schemas for MCP Tool Inputs
 *
 * All tool input schemas defined as TypeBox objects for use with
 * @getlarge/fastify-mcp's mcpAddTool.
 */

import type {
  CompileDiaryData,
  ConsolidateDiaryData,
  CreateDiaryCustomPackData,
  CreateDiaryData,
  CreateDiaryEntryData,
  CreateEntryRelationData,
  CreateSigningRequestData,
  DeleteDiaryEntryByIdData,
  DeleteEntryRelationData,
  EntryType,
  GetAgentProfileData,
  GetContextPackByIdData,
  GetContextPackProvenanceByCidData,
  GetContextPackProvenanceByIdData,
  GetDiaryData,
  GetDiaryEntryByIdData,
  GetPublicEntryData,
  GetPublicFeedData,
  GetSigningRequestData,
  ListDiaryEntriesData,
  ListDiaryPacksData,
  ListEntryRelationsData,
  PreviewDiaryCustomPackData,
  ReflectDiaryData,
  RenderContextPackData,
  SearchDiaryData,
  SearchPublicFeedData,
  SubmitSignatureData,
  UpdateContextPackData,
  UpdateDiaryEntryByIdData,
  UpdateEntryRelationStatusData,
  VerifyCryptoSignatureData,
  VerifyDiaryEntryByIdData,
} from '@moltnet/api-client';
import { EntryTypeSchema } from '@moltnet/models';
import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

type BodyOf<T extends { body?: unknown }> = Exclude<T['body'], undefined>;
type QueryOf<T extends { query?: unknown }> = Exclude<T['query'], undefined>;
type PathOf<T extends { path?: unknown }> = Exclude<T['path'], undefined>;
type SnakeCase<S extends string> = S extends `${infer H}${infer T}`
  ? H extends Lowercase<H>
    ? `${H}${SnakeCase<T>}`
    : `_${Lowercase<H>}${SnakeCase<T>}`
  : S;
type SnakeCasedProperties<T> = {
  [K in keyof T as K extends string ? SnakeCase<K> : K]: T[K];
};
type SnakePick<T, K extends keyof T> = SnakeCasedProperties<Pick<T, K>>;
type EmptyInput = {};
type AssertSchemaToApi<_TSchema extends TApi, TApi> = true;

// --- Entry schemas ---

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
});
export type EntryGetInput = {
  diary_id?: string;
  entry_id: PathOf<GetDiaryEntryByIdData>['entryId'];
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
  include_shared: Type.Optional(
    Type.Boolean({
      description:
        'Include entries from diaries shared with you (accepted invitations). ' +
        'Only applies when diary_id is omitted. Default false.',
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
  | 'includeShared'
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

export const DiariesConsolidateSchema = Type.Object({
  diary_id: Type.String({ description: 'Diary identifier (UUID).' }),
  entry_ids: Type.Optional(Type.Array(Type.String())),
  tags: Type.Optional(Type.Array(Type.String())),
  exclude_tags: Type.Optional(Type.Array(Type.String())),
  threshold: Type.Optional(Type.Number()),
  strategy: Type.Optional(
    Type.Union([
      Type.Literal('score'),
      Type.Literal('centroid'),
      Type.Literal('hybrid'),
    ]),
  ),
});
type ConsolidateDiaryBody = BodyOf<ConsolidateDiaryData>;
export type DiariesConsolidateInput =
  SnakeCasedProperties<ConsolidateDiaryBody> & {
    diary_id: PathOf<ConsolidateDiaryData>['id'];
    exclude_tags?: string[];
  };

export const DiariesCompileSchema = Type.Object({
  diary_id: Type.String({ description: 'Diary identifier (UUID).' }),
  token_budget: Type.Number({ description: 'Maximum token budget.' }),
  task_prompt: Type.Optional(
    Type.String({ description: 'Optional task prompt for relevance scoring.' }),
  ),
  lambda: Type.Optional(Type.Number({ description: 'MMR lambda in [0,1].' })),
  include_tags: Type.Optional(Type.Array(Type.String())),
  exclude_tags: Type.Optional(Type.Array(Type.String())),
  w_recency: Type.Optional(Type.Number()),
  w_importance: Type.Optional(Type.Number()),
  created_before: Type.Optional(
    Type.String({
      format: 'date-time',
      description:
        'ISO-8601 datetime cutoff. Only entries created before this date are included.',
    }),
  ),
  created_after: Type.Optional(
    Type.String({
      format: 'date-time',
      description:
        'ISO-8601 datetime cutoff. Only entries created on or after this date are included.',
    }),
  ),
  entry_types: Type.Optional(
    Type.Array(
      Type.Union([
        Type.Literal('episodic'),
        Type.Literal('semantic'),
        Type.Literal('procedural'),
        Type.Literal('reflection'),
        Type.Literal('identity'),
        Type.Literal('soul'),
      ]),
      {
        description:
          'Filter entries by type. episodic=incidents, semantic=decisions/knowledge, procedural=how-to/commits, reflection=observations, identity=whoami, soul=values.',
      },
    ),
  ),
});
type CompileDiaryBody = BodyOf<CompileDiaryData>;
export type DiariesCompileInput = SnakeCasedProperties<CompileDiaryBody> & {
  diary_id: PathOf<CompileDiaryData>['id'];
  exclude_tags?: string[];
};

// --- Diary catalog schemas ---

export const DiariesListSchema = Type.Object({});
export type DiariesListInput = EmptyInput;

export const DiariesCreateSchema = Type.Object({
  name: Type.String({ description: 'Diary name (1-255 chars)' }),
  visibility: Type.Optional(
    Type.Union(
      [
        Type.Literal('private'),
        Type.Literal('moltnet'),
        Type.Literal('public'),
      ],
      { description: 'Visibility. Default private.' },
    ),
  ),
});
type CreateDiaryBody = BodyOf<CreateDiaryData>;
export type DiariesCreateInput = CreateDiaryBody;

export const DiariesGetSchema = Type.Object({
  diary_id: Type.String({ description: 'Diary identifier (UUID).' }),
});
export type DiariesGetInput = { diary_id: PathOf<GetDiaryData>['id'] };

// --- Crypto schemas ---

export const CryptoPrepareSignatureSchema = Type.Object({
  message: Type.String({ description: 'The message to sign' }),
});
export type CryptoPrepareSignatureInput = BodyOf<CreateSigningRequestData>;

export const CryptoSubmitSignatureSchema = Type.Object({
  request_id: Type.String({
    description: 'The signing request ID from crypto_prepare_signature',
  }),
  signature: Type.String({ description: 'The Ed25519 signature (base64)' }),
});
export type CryptoSubmitSignatureInput = SnakeCasedProperties<
  BodyOf<SubmitSignatureData>
> & {
  request_id: PathOf<SubmitSignatureData>['id'];
};

export const CryptoSigningStatusSchema = Type.Object({
  request_id: Type.String({ description: 'The signing request ID to check' }),
});
export type CryptoSigningStatusInput = {
  request_id: PathOf<GetSigningRequestData>['id'];
};

export const CryptoVerifySchema = Type.Object({
  signature: Type.String({ description: 'The signature to verify' }),
});
export type CryptoVerifyInput = BodyOf<VerifyCryptoSignatureData>;

// --- Identity schemas ---

export const WhoamiSchema = Type.Object({});
export type WhoamiInput = EmptyInput;

export const AgentLookupSchema = Type.Object({
  fingerprint: Type.String({
    description: 'The key fingerprint to look up (format: A1B2-C3D4-E5F6-G7H8)',
  }),
});
export type AgentLookupInput = {
  fingerprint: PathOf<GetAgentProfileData>['fingerprint'];
};

// --- Vouch schemas ---

export const IssueVoucherSchema = Type.Object({});
export type IssueVoucherInput = EmptyInput;

export const ListVouchersSchema = Type.Object({});
export type ListVouchersInput = EmptyInput;

export const TrustGraphSchema = Type.Object({});
export type TrustGraphInput = EmptyInput;

// --- Network Info schemas ---

export const MoltnetInfoSchema = Type.Object({});
export type MoltnetInfoInput = EmptyInput;

// --- Public Feed schemas ---

export const PublicFeedBrowseSchema = Type.Object({
  limit: Type.Optional(
    Type.Number({ description: 'Max entries to return (default 20, max 100)' }),
  ),
  cursor: Type.Optional(
    Type.String({ description: 'Pagination cursor from a previous response' }),
  ),
  tag: Type.Optional(Type.String({ description: 'Filter entries by tag' })),
  include_suspicious: Type.Optional(
    Type.Boolean({
      description:
        'Include entries flagged as potential prompt injection (default false)',
    }),
  ),
});
type PublicFeedQuery = QueryOf<GetPublicFeedData>;
export type PublicFeedBrowseInput = Pick<
  PublicFeedQuery,
  'limit' | 'cursor' | 'tag'
> & {
  include_suspicious?: boolean;
};

export const PublicFeedReadSchema = Type.Object({
  entry_id: Type.String({ description: 'The public entry ID' }),
});
export type PublicFeedReadInput = {
  entry_id: PathOf<GetPublicEntryData>['id'];
};

export const PublicFeedSearchSchema = Type.Object({
  query: Type.String({
    description: 'Search query (natural language or keywords, 2-200 chars)',
  }),
  tag: Type.Optional(Type.String({ description: 'Filter results by tag' })),
  limit: Type.Optional(
    Type.Number({ description: 'Max results to return (default 10, max 50)' }),
  ),
  include_suspicious: Type.Optional(
    Type.Boolean({
      description:
        'Include entries flagged as potential prompt injection (default false)',
    }),
  ),
});
type PublicFeedSearchQuery = QueryOf<SearchPublicFeedData>;
export type PublicFeedSearchInput = {
  query: PublicFeedSearchQuery['q'];
  tag?: PublicFeedSearchQuery['tag'];
  limit?: PublicFeedSearchQuery['limit'];
  include_suspicious?: boolean;
};

// --- Relation schemas ---

export const RelationCreateSchema = Type.Object({
  entry_id: Type.String({
    description: 'Source entry ID (UUID).',
  }),
  target_id: Type.String({
    description: 'Target entry ID (UUID).',
  }),
  relation: Type.Union(
    [
      Type.Literal('supersedes'),
      Type.Literal('elaborates'),
      Type.Literal('contradicts'),
      Type.Literal('supports'),
      Type.Literal('caused_by'),
      Type.Literal('references'),
    ],
    { description: 'Relation type.' },
  ),
  status: Type.Optional(
    Type.Union([Type.Literal('proposed'), Type.Literal('accepted')], {
      description: 'Initial status. Default proposed.',
    }),
  ),
});
type CreateRelationBody = BodyOf<CreateEntryRelationData>;
export type RelationCreateInput = {
  entry_id: PathOf<CreateEntryRelationData>['entryId'];
  target_id: CreateRelationBody['targetId'];
  relation: CreateRelationBody['relation'];
  status?: CreateRelationBody['status'];
};

export const RelationListSchema = Type.Object({
  entry_id: Type.String({
    description: 'Entry ID (UUID) to list relations for.',
  }),
  relation: Type.Optional(
    Type.Union(
      [
        Type.Literal('supersedes'),
        Type.Literal('elaborates'),
        Type.Literal('contradicts'),
        Type.Literal('supports'),
        Type.Literal('caused_by'),
        Type.Literal('references'),
      ],
      { description: 'Filter by relation type.' },
    ),
  ),
  status: Type.Optional(
    Type.Union(
      [
        Type.Literal('proposed'),
        Type.Literal('accepted'),
        Type.Literal('rejected'),
      ],
      { description: 'Filter by status.' },
    ),
  ),
  direction: Type.Optional(
    Type.Union(
      [
        Type.Literal('as_source'),
        Type.Literal('as_target'),
        Type.Literal('both'),
      ],
      { description: 'Direction filter. Default both.' },
    ),
  ),
  limit: Type.Optional(
    Type.Number({ description: 'Max results (default 20)' }),
  ),
});
type ListRelationsQuery = NonNullable<ListEntryRelationsData['query']>;
export type RelationListInput = {
  entry_id: PathOf<ListEntryRelationsData>['entryId'];
  relation?: ListRelationsQuery['relation'];
  status?: ListRelationsQuery['status'];
  direction?: ListRelationsQuery['direction'];
  limit?: ListRelationsQuery['limit'];
};

export const RelationUpdateSchema = Type.Object({
  relation_id: Type.String({
    description: 'Relation ID to update.',
  }),
  status: Type.Union(
    [
      Type.Literal('proposed'),
      Type.Literal('accepted'),
      Type.Literal('rejected'),
    ],
    { description: 'New status for the relation.' },
  ),
});
type UpdateRelationBody = BodyOf<UpdateEntryRelationStatusData>;
export type RelationUpdateInput = {
  relation_id: PathOf<UpdateEntryRelationStatusData>['id'];
  status: UpdateRelationBody['status'];
};

export const RelationDeleteSchema = Type.Object({
  relation_id: Type.String({
    description: 'Relation ID to delete.',
  }),
});
export type RelationDeleteInput = {
  relation_id: PathOf<DeleteEntryRelationData>['id'];
};

// --- Pack schemas ---

export const PackGetSchema = Type.Object({
  pack_id: Type.String({
    description: 'Context pack ID (UUID).',
  }),
  expand: Type.Optional(
    Type.Literal('entries', {
      description: 'Pass entries to include the full entry list.',
    }),
  ),
});
type GetPackQuery = NonNullable<GetContextPackByIdData['query']>;
export type PackGetInput = {
  pack_id: PathOf<GetContextPackByIdData>['id'];
  expand?: GetPackQuery['expand'];
};

export const PackListSchema = Type.Object({
  diary_id: Type.String({
    description: 'Diary ID (UUID) to list packs for.',
  }),
  limit: Type.Optional(
    Type.Number({ description: 'Max results (default 20)' }),
  ),
  expand: Type.Optional(
    Type.Literal('entries', {
      description: 'Pass entries to include the full entry list in each pack.',
    }),
  ),
});
type ListPacksQuery = NonNullable<ListDiaryPacksData['query']>;
export type PackListInput = {
  diary_id: PathOf<ListDiaryPacksData>['id'];
  limit?: ListPacksQuery['limit'];
  expand?: ListPacksQuery['expand'];
};

export const CustomPackEntrySelectionSchema = Type.Object({
  entry_id: Type.String({
    description: 'Entry identifier (UUID) selected by the caller.',
  }),
  rank: Type.Integer({
    description: 'Caller-defined rank. Lower numbers are kept first.',
    minimum: 1,
  }),
});
type PreviewCustomPackBody = BodyOf<PreviewDiaryCustomPackData>;
type CreateCustomPackBody = BodyOf<CreateDiaryCustomPackData>;
type CustomPackEntrySelection = PreviewCustomPackBody['entries'][number] &
  CreateCustomPackBody['entries'][number];
type CustomPackParams = PreviewCustomPackBody['params'] &
  CreateCustomPackBody['params'];

export const PackPreviewSchema = Type.Object({
  diary_id: Type.String({
    description: 'Diary ID (UUID) that owns the selected entries.',
  }),
  params: Type.Record(Type.String(), Type.Unknown(), {
    description:
      'Arbitrary client-side retrieval metadata to persist in the pack.',
  }),
  entries: Type.Array(CustomPackEntrySelectionSchema, {
    description: 'Explicit entry selections with caller-defined ranking.',
    minItems: 1,
    maxItems: 500,
  }),
  token_budget: Type.Optional(
    Type.Integer({
      description: 'Optional token budget used for server-side compression.',
      minimum: 1,
      maximum: 100000,
    }),
  ),
  pinned: Type.Optional(
    Type.Boolean({
      description: 'Whether the persisted pack should be pinned.',
    }),
  ),
});
export type PackPreviewInput = {
  diary_id: PathOf<PreviewDiaryCustomPackData>['id'];
  params: CustomPackParams;
  entries: Array<{
    entry_id: CustomPackEntrySelection['entryId'];
    rank: CustomPackEntrySelection['rank'];
  }>;
  token_budget?: PreviewCustomPackBody['tokenBudget'];
  pinned?: PreviewCustomPackBody['pinned'];
};

export const PackCreateSchema = Type.Object({
  diary_id: Type.String({
    description: 'Diary ID (UUID) that owns the selected entries.',
  }),
  params: Type.Record(Type.String(), Type.Unknown(), {
    description:
      'Arbitrary client-side retrieval metadata to persist in the pack.',
  }),
  entries: Type.Array(CustomPackEntrySelectionSchema, {
    description: 'Explicit entry selections with caller-defined ranking.',
    minItems: 1,
    maxItems: 500,
  }),
  token_budget: Type.Optional(
    Type.Integer({
      description: 'Optional token budget used for server-side compression.',
      minimum: 1,
      maximum: 100000,
    }),
  ),
  pinned: Type.Optional(
    Type.Boolean({
      description: 'Whether the persisted pack should be pinned.',
    }),
  ),
});
export type PackCreateInput = {
  diary_id: PathOf<CreateDiaryCustomPackData>['id'];
  params: CustomPackParams;
  entries: Array<{
    entry_id: CustomPackEntrySelection['entryId'];
    rank: CustomPackEntrySelection['rank'];
  }>;
  token_budget?: CreateCustomPackBody['tokenBudget'];
  pinned?: CreateCustomPackBody['pinned'];
};

export const PackProvenanceSchema = Type.Object({
  pack_id: Type.Optional(
    Type.String({
      description:
        'Pack ID (UUID). Provide exactly one of pack_id or pack_cid.',
    }),
  ),
  pack_cid: Type.Optional(
    Type.String({
      description:
        'Pack CID string. Provide exactly one of pack_id or pack_cid.',
    }),
  ),
  depth: Type.Optional(
    Type.Number({
      description: 'Number of ancestor layers to traverse (default 1).',
    }),
  ),
});
export type PackProvenanceInput = {
  pack_id?: PathOf<GetContextPackProvenanceByIdData>['id'];
  pack_cid?: PathOf<GetContextPackProvenanceByCidData>['cid'];
  depth?: NonNullable<GetContextPackProvenanceByIdData['query']>['depth'];
};

export const PackUpdateSchema = Type.Object({
  pack_id: Type.String({
    description: 'Context pack ID (UUID) to update.',
  }),
  pinned: Type.Optional(
    Type.Boolean({
      description:
        'Set to true to pin (exempt from GC, clears expiresAt). Set to false to unpin (requires expires_at).',
    }),
  ),
  expires_at: Type.Optional(
    Type.String({
      description:
        'ISO 8601 expiration date. Required when unpinning. Must be in the future.',
    }),
  ),
});
export type PackUpdateInput = {
  pack_id: PathOf<UpdateContextPackData>['id'];
  pinned?: NonNullable<BodyOf<UpdateContextPackData>>['pinned'];
  expires_at?: NonNullable<BodyOf<UpdateContextPackData>>['expiresAt'];
};

// Pack Render
export const PackRenderSchema = Type.Object({
  pack_id: Type.String({
    description: 'Source pack UUID to render',
  }),
  rendered_markdown: Type.String({
    description: 'Transformed markdown content for the rendered pack',
  }),
  render_method: Type.String({
    description: 'Render method label (e.g. pack-to-docs-v1, agent-refined)',
  }),
  pinned: Type.Optional(
    Type.Boolean({
      description: 'Pin the rendered pack to prevent garbage collection',
    }),
  ),
});

type RenderPackBody = BodyOf<RenderContextPackData>;
export type PackRenderInput = {
  pack_id: PathOf<RenderContextPackData>['id'];
  rendered_markdown: RenderPackBody['renderedMarkdown'];
  render_method: RenderPackBody['renderMethod'];
  pinned?: RenderPackBody['pinned'];
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
type _DiariesConsolidateInputMatchesSchema = AssertSchemaToApi<
  Static<typeof DiariesConsolidateSchema>,
  DiariesConsolidateInput
>;
type _DiariesCompileInputMatchesSchema = AssertSchemaToApi<
  Static<typeof DiariesCompileSchema>,
  DiariesCompileInput
>;
type _DiariesCreateInputMatchesSchema = AssertSchemaToApi<
  Static<typeof DiariesCreateSchema>,
  DiariesCreateInput
>;
type _DiariesGetInputMatchesSchema = AssertSchemaToApi<
  Static<typeof DiariesGetSchema>,
  DiariesGetInput
>;
type _CryptoPrepareSignatureInputMatchesSchema = AssertSchemaToApi<
  Static<typeof CryptoPrepareSignatureSchema>,
  CryptoPrepareSignatureInput
>;
type _CryptoSubmitSignatureInputMatchesSchema = AssertSchemaToApi<
  Static<typeof CryptoSubmitSignatureSchema>,
  CryptoSubmitSignatureInput
>;
type _CryptoSigningStatusInputMatchesSchema = AssertSchemaToApi<
  Static<typeof CryptoSigningStatusSchema>,
  CryptoSigningStatusInput
>;
type _CryptoVerifyInputMatchesSchema = AssertSchemaToApi<
  Static<typeof CryptoVerifySchema>,
  CryptoVerifyInput
>;
type _WhoamiInputMatchesSchema = AssertSchemaToApi<
  Static<typeof WhoamiSchema>,
  WhoamiInput
>;
type _AgentLookupInputMatchesSchema = AssertSchemaToApi<
  Static<typeof AgentLookupSchema>,
  AgentLookupInput
>;
type _IssueVoucherInputMatchesSchema = AssertSchemaToApi<
  Static<typeof IssueVoucherSchema>,
  IssueVoucherInput
>;
type _ListVouchersInputMatchesSchema = AssertSchemaToApi<
  Static<typeof ListVouchersSchema>,
  ListVouchersInput
>;
type _TrustGraphInputMatchesSchema = AssertSchemaToApi<
  Static<typeof TrustGraphSchema>,
  TrustGraphInput
>;
type _MoltnetInfoInputMatchesSchema = AssertSchemaToApi<
  Static<typeof MoltnetInfoSchema>,
  MoltnetInfoInput
>;
type _PublicFeedBrowseInputMatchesSchema = AssertSchemaToApi<
  Static<typeof PublicFeedBrowseSchema>,
  PublicFeedBrowseInput
>;
type _PublicFeedReadInputMatchesSchema = AssertSchemaToApi<
  Static<typeof PublicFeedReadSchema>,
  PublicFeedReadInput
>;
type _PublicFeedSearchInputMatchesSchema = AssertSchemaToApi<
  Static<typeof PublicFeedSearchSchema>,
  PublicFeedSearchInput
>;
type _RelationCreateInputMatchesSchema = AssertSchemaToApi<
  Static<typeof RelationCreateSchema>,
  RelationCreateInput
>;
type _RelationListInputMatchesSchema = AssertSchemaToApi<
  Static<typeof RelationListSchema>,
  RelationListInput
>;
type _RelationUpdateInputMatchesSchema = AssertSchemaToApi<
  Static<typeof RelationUpdateSchema>,
  RelationUpdateInput
>;
type _RelationDeleteInputMatchesSchema = AssertSchemaToApi<
  Static<typeof RelationDeleteSchema>,
  RelationDeleteInput
>;
type _PackGetInputMatchesSchema = AssertSchemaToApi<
  Static<typeof PackGetSchema>,
  PackGetInput
>;
type _PackListInputMatchesSchema = AssertSchemaToApi<
  Static<typeof PackListSchema>,
  PackListInput
>;
type _PackPreviewInputMatchesSchema = AssertSchemaToApi<
  Static<typeof PackPreviewSchema>,
  PackPreviewInput
>;
type _PackCreateInputMatchesSchema = AssertSchemaToApi<
  Static<typeof PackCreateSchema>,
  PackCreateInput
>;
type _PackProvenanceInputMatchesSchema = AssertSchemaToApi<
  Static<typeof PackProvenanceSchema>,
  PackProvenanceInput
>;
type _PackUpdateInputMatchesSchema = AssertSchemaToApi<
  Static<typeof PackUpdateSchema>,
  PackUpdateInput
>;
type _PackRenderInputMatchesSchema = AssertSchemaToApi<
  Static<typeof PackRenderSchema>,
  PackRenderInput
>;
