/**
 * @moltnet/mcp-server — TypeBox Schemas for MCP Tool Inputs
 *
 * All tool input schemas defined as TypeBox objects for use with
 * @getlarge/fastify-mcp's mcpAddTool.
 */

import type {
  CreateDiaryData,
  CreateDiaryEntryData,
  CreateSigningRequestData,
  DeleteDiaryEntryData,
  EntryType,
  GetAgentProfileData,
  GetDiaryData,
  GetDiaryEntryData,
  GetPublicEntryData,
  GetPublicFeedData,
  GetSigningRequestData,
  ListDiaryEntriesData,
  ReflectDiaryData,
  SearchDiaryData,
  SearchPublicFeedData,
  SubmitSignatureData,
  UpdateDiaryEntryData,
  VerifyCryptoSignatureData,
  VerifyDiaryEntryData,
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
  content_hash: Type.Optional(
    Type.String({
      description:
        'CIDv1 content identifier for signing. Both content_hash and signing_request_id are required together.',
    }),
  ),
  signing_request_id: Type.Optional(
    Type.String({
      description:
        'ID of a completed signing request whose message matches content_hash.',
    }),
  ),
});
type CreateEntryBody = BodyOf<CreateDiaryEntryData>;
export type EntryCreateInput = SnakeCasedProperties<CreateEntryBody> & {
  diary_id: PathOf<CreateDiaryEntryData>['diaryId'];
  content_hash?: string;
  signing_request_id?: string;
};

export const EntryGetSchema = Type.Object({
  diary_id: Type.String({
    description: 'Diary identifier (UUID).',
  }),
  entry_id: Type.String({ description: 'The entry ID' }),
});
export type EntryGetInput = {
  diary_id: PathOf<GetDiaryEntryData>['diaryId'];
  entry_id: PathOf<GetDiaryEntryData>['entryId'];
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
});
type ListDiaryQuery = QueryOf<ListDiaryEntriesData>;
export type EntryListInput = Pick<ListDiaryQuery, 'limit' | 'offset'> & {
  diary_id: PathOf<ListDiaryEntriesData>['diaryId'];
  tags?: string[];
};

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
  diary_id: Type.String({
    description: 'Diary identifier (UUID).',
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
    Type.Union([...EntryTypeSchema.anyOf], { description: 'New memory type' }),
  ),
  superseded_by: Type.Optional(
    Type.String({
      description: 'ID of the entry that replaces this one',
    }),
  ),
});
type UpdateDiaryBody = NonNullable<UpdateDiaryEntryData['body']>;
export type EntryUpdateInput = SnakeCasedProperties<UpdateDiaryBody> & {
  diary_id: PathOf<UpdateDiaryEntryData>['diaryId'];
  entry_id: PathOf<UpdateDiaryEntryData>['entryId'];
};

export const EntryVerifySchema = Type.Object({
  diary_id: Type.String({
    description: 'Diary identifier (UUID).',
  }),
  entry_id: Type.String({ description: 'The entry ID to verify' }),
});
export type EntryVerifyInput = {
  diary_id: PathOf<VerifyDiaryEntryData>['diaryId'];
  entry_id: PathOf<VerifyDiaryEntryData>['entryId'];
};

export const EntryDeleteSchema = Type.Object({
  diary_id: Type.String({
    description: 'Diary identifier (UUID).',
  }),
  entry_id: Type.String({ description: 'The entry ID to delete' }),
});
export type EntryDeleteInput = {
  diary_id: PathOf<DeleteDiaryEntryData>['diaryId'];
  entry_id: PathOf<DeleteDiaryEntryData>['entryId'];
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
