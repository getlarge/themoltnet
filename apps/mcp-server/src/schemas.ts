/**
 * @moltnet/mcp-server — TypeBox Schemas for MCP Tool Inputs
 *
 * All tool input schemas defined as TypeBox objects for use with
 * @getlarge/fastify-mcp's mcpAddTool.
 */

import type {
  CreateDiaryEntryData,
  CreateSigningRequestData,
  DeleteDiaryEntryData,
  EntryType,
  GetAgentProfileData,
  GetDiaryEntryData,
  GetPublicEntryData,
  GetPublicFeedData,
  GetSharedWithMeData,
  GetSigningRequestData,
  ListDiaryEntriesData,
  ReflectDiaryData,
  SearchDiaryData,
  SearchPublicFeedData,
  SetDiaryEntryVisibilityData,
  ShareDiaryEntryData,
  SubmitSignatureData,
  UpdateDiaryEntryData,
  VerifyCryptoSignatureData,
} from '@moltnet/api-client';
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

// --- Diary schemas ---

const EntryTypeLiterals = [
  Type.Literal('episodic'),
  Type.Literal('semantic'),
  Type.Literal('procedural'),
  Type.Literal('reflection'),
  Type.Literal('identity'),
  Type.Literal('soul'),
] as const;

export const DiaryCreateSchema = Type.Object({
  diary_ref: Type.String({
    description: 'Diary identifier (ID or key).',
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
    Type.Union([...EntryTypeLiterals], {
      description: 'Memory type. Default semantic.',
    }),
  ),
});
type CreateDiaryBody = BodyOf<CreateDiaryEntryData>;
export type DiaryCreateInput = SnakeCasedProperties<CreateDiaryBody> & {
  diary_ref: PathOf<CreateDiaryEntryData>['diaryRef'];
};

export const DiaryGetSchema = Type.Object({
  diary_ref: Type.String({
    description: 'Diary identifier (ID or key).',
  }),
  entry_id: Type.String({ description: 'The entry ID' }),
});
export type DiaryGetInput = {
  diary_ref: PathOf<GetDiaryEntryData>['diaryRef'];
  entry_id: PathOf<GetDiaryEntryData>['id'];
};

export const DiaryListSchema = Type.Object({
  diary_ref: Type.String({
    description: 'Diary identifier (ID or key).',
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
});
type ListDiaryQuery = QueryOf<ListDiaryEntriesData>;
export type DiaryListInput = Pick<ListDiaryQuery, 'limit' | 'offset'> & {
  diary_ref: PathOf<ListDiaryEntriesData>['diaryRef'];
  tags?: string[];
};

export const DiarySearchSchema = Type.Object({
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
    Type.Array(Type.Union([...EntryTypeLiterals]), {
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
type DiarySearchFields = SnakePick<
  SearchDiaryBody,
  | 'query'
  | 'limit'
  | 'tags'
  | 'wRelevance'
  | 'wRecency'
  | 'wImportance'
  | 'entryTypes'
  | 'excludeSuperseded'
>;
export type DiarySearchInput = Omit<DiarySearchFields, 'query'> & {
  query: NonNullable<SearchDiaryBody['query']>;
};

export const DiaryUpdateSchema = Type.Object({
  diary_ref: Type.String({
    description: 'Diary identifier (ID or key).',
  }),
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
    Type.Union([...EntryTypeLiterals], { description: 'New memory type' }),
  ),
  superseded_by: Type.Optional(
    Type.String({
      description: 'ID of the entry that replaces this one',
    }),
  ),
});
type UpdateDiaryBody = NonNullable<UpdateDiaryEntryData['body']>;
export type DiaryUpdateInput = SnakeCasedProperties<UpdateDiaryBody> & {
  diary_ref: PathOf<UpdateDiaryEntryData>['diaryRef'];
  entry_id: PathOf<UpdateDiaryEntryData>['id'];
};

export const DiaryDeleteSchema = Type.Object({
  diary_ref: Type.String({
    description: 'Diary identifier (ID or key).',
  }),
  entry_id: Type.String({ description: 'The entry ID to delete' }),
});
export type DiaryDeleteInput = {
  diary_ref: PathOf<DeleteDiaryEntryData>['diaryRef'];
  entry_id: PathOf<DeleteDiaryEntryData>['id'];
};

export const DiaryReflectSchema = Type.Object({
  days: Type.Optional(
    Type.Number({
      description: 'Only include entries from the last N days (default 7)',
    }),
  ),
  max_entries: Type.Optional(
    Type.Number({ description: 'Max entries to include (default 50)' }),
  ),
  entry_types: Type.Optional(
    Type.Array(Type.Union([...EntryTypeLiterals]), {
      description: 'Filter by memory type',
    }),
  ),
});
type ReflectDiaryQuery = QueryOf<ReflectDiaryData>;
export type DiaryReflectInput = {
  days?: ReflectDiaryQuery['days'];
  max_entries?: ReflectDiaryQuery['maxEntries'];
  entry_types?: EntryType[];
};

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

// --- Sharing schemas ---

export const DiarySetVisibilitySchema = Type.Object({
  diary_ref: Type.String({
    description: 'Diary identifier (ID or key).',
  }),
  entry_id: Type.String({ description: 'The entry ID' }),
  visibility: Type.Union(
    [Type.Literal('private'), Type.Literal('moltnet'), Type.Literal('public')],
    { description: 'New visibility level' },
  ),
});
export type DiarySetVisibilityInput = SnakeCasedProperties<
  BodyOf<SetDiaryEntryVisibilityData>
> & {
  diary_ref: PathOf<SetDiaryEntryVisibilityData>['diaryRef'];
  entry_id: PathOf<SetDiaryEntryVisibilityData>['id'];
};

export const DiaryShareSchema = Type.Object({
  diary_ref: Type.String({
    description: 'Diary identifier (ID or key).',
  }),
  entry_id: Type.String({ description: 'The entry ID to share' }),
  with_agent: Type.String({
    description: 'Fingerprint of the agent to share with',
  }),
});
export type DiaryShareInput = {
  diary_ref: PathOf<ShareDiaryEntryData>['diaryRef'];
  entry_id: PathOf<ShareDiaryEntryData>['id'];
  with_agent: BodyOf<ShareDiaryEntryData>['sharedWith'];
};

export const DiarySharedWithMeSchema = Type.Object({
  limit: Type.Optional(
    Type.Number({ description: 'Max results (default 20)' }),
  ),
});
type SharedWithMeQuery = QueryOf<GetSharedWithMeData>;
export type DiarySharedWithMeInput = Pick<SharedWithMeQuery, 'limit'>;

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
});
type PublicFeedQuery = QueryOf<GetPublicFeedData>;
export type PublicFeedBrowseInput = Pick<
  PublicFeedQuery,
  'limit' | 'cursor' | 'tag'
>;

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
});
type PublicFeedSearchQuery = QueryOf<SearchPublicFeedData>;
export type PublicFeedSearchInput = {
  query: PublicFeedSearchQuery['q'];
  tag?: PublicFeedSearchQuery['tag'];
  limit?: PublicFeedSearchQuery['limit'];
};

// --- Compile-time drift checks ---

type _DiaryCreateInputMatchesSchema = AssertSchemaToApi<
  Static<typeof DiaryCreateSchema>,
  DiaryCreateInput
>;
type _DiaryGetInputMatchesSchema = AssertSchemaToApi<
  Static<typeof DiaryGetSchema>,
  DiaryGetInput
>;
type _DiaryListInputMatchesSchema = AssertSchemaToApi<
  Static<typeof DiaryListSchema>,
  DiaryListInput
>;
type _DiarySearchInputMatchesSchema = AssertSchemaToApi<
  Static<typeof DiarySearchSchema>,
  DiarySearchInput
>;
type _DiaryUpdateInputMatchesSchema = AssertSchemaToApi<
  Static<typeof DiaryUpdateSchema>,
  DiaryUpdateInput
>;
type _DiaryDeleteInputMatchesSchema = AssertSchemaToApi<
  Static<typeof DiaryDeleteSchema>,
  DiaryDeleteInput
>;
type _DiaryReflectInputMatchesSchema = AssertSchemaToApi<
  Static<typeof DiaryReflectSchema>,
  DiaryReflectInput
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
type _DiarySetVisibilityInputMatchesSchema = AssertSchemaToApi<
  Static<typeof DiarySetVisibilitySchema>,
  DiarySetVisibilityInput
>;
type _DiaryShareInputMatchesSchema = AssertSchemaToApi<
  Static<typeof DiaryShareSchema>,
  DiaryShareInput
>;
type _DiarySharedWithMeInputMatchesSchema = AssertSchemaToApi<
  Static<typeof DiarySharedWithMeSchema>,
  DiarySharedWithMeInput
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
