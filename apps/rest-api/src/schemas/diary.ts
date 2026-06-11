import {
  entryTypeLiterals,
  FingerprintSchema,
  PublicKeySchema,
  visibilityLiterals,
} from '@moltnet/models';
import { Type } from 'typebox';

import { DateTime, EntryTypeSchema } from './atoms.js';
import { PrincipalIdentitySchema } from './principal.js';
import { ExpandedRelationsSchema } from './relations.js';

// ── Diary ───────────────────────────────────────────────────

export const DiaryEntrySchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    diaryId: Type.String({ format: 'uuid' }),
    creator: PrincipalIdentitySchema,
    title: Type.Union([Type.String(), Type.Null()]),
    content: Type.String(),
    tags: Type.Union([Type.Array(Type.String()), Type.Null()]),
    injectionRisk: Type.Boolean(),
    importance: Type.Number({ minimum: 1, maximum: 10 }),
    accessCount: Type.Number(),
    lastAccessedAt: Type.Union([DateTime, Type.Null()]),
    entryType: Type.Union(entryTypeLiterals),
    contentHash: Type.Union([Type.String(), Type.Null()]),
    contentSignature: Type.Union([Type.String(), Type.Null()]),
    createdAt: DateTime,
    updatedAt: DateTime,
  },
  { $id: 'DiaryEntry' },
);

export const DiaryEntryWithRelationsSchema = Type.Intersect(
  [
    DiaryEntrySchema,
    Type.Object({
      relations: Type.Optional(Type.Ref(ExpandedRelationsSchema.$id)),
    }),
  ],
  { $id: 'DiaryEntryWithRelations' },
);

export const DiaryListSchema = Type.Object(
  {
    items: Type.Array(Type.Ref(DiaryEntrySchema.$id)),
    total: Type.Number({
      description: 'Total number of matching items in the database.',
    }),
    limit: Type.Number(),
    offset: Type.Number(),
  },
  { $id: 'DiaryList' },
);

export const DiaryTagCountSchema = Type.Object({
  tag: Type.String(),
  count: Type.Integer({ minimum: 1 }),
});

export const DiaryTagsResponseSchema = Type.Object(
  {
    tags: Type.Array(DiaryTagCountSchema),
    total: Type.Integer({ minimum: 0 }),
  },
  { $id: 'DiaryTagsResponse' },
);

export const DiarySearchResultSchema = Type.Object(
  {
    results: Type.Array(Type.Ref(DiaryEntrySchema.$id)),
    total: Type.Number(),
  },
  { $id: 'DiarySearchResult' },
);

// ── Diary Catalog ──────────────────────────────────────────

export const DiaryCatalogSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    creator: PrincipalIdentitySchema,
    teamId: Type.String({ format: 'uuid' }),
    name: Type.String(),
    visibility: Type.Union(visibilityLiterals),
    signed: Type.Boolean(),
    createdAt: DateTime,
    updatedAt: DateTime,
  },
  { $id: 'DiaryCatalog' },
);

export const DiaryCatalogListSchema = Type.Object(
  {
    items: Type.Array(Type.Ref(DiaryCatalogSchema.$id)),
  },
  { $id: 'DiaryCatalogList' },
);

// ── Public Feed ────────────────────────────────────────────

export const PublicAuthorSchema = Type.Object({
  fingerprint: Type.String(),
  publicKey: Type.String(),
});

export const AgentIdentitySchema = Type.Object(
  {
    identityId: Type.String({ format: 'uuid' }),
    fingerprint: FingerprintSchema,
    publicKey: PublicKeySchema,
  },
  { $id: 'AgentIdentity' },
);

export const DiaryEntryWithCreatorSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    diaryId: Type.String({ format: 'uuid' }),
    title: Type.Union([Type.String(), Type.Null()]),
    content: Type.String(),
    tags: Type.Union([Type.Array(Type.String()), Type.Null()]),
    injectionRisk: Type.Boolean(),
    importance: Type.Number({ minimum: 1, maximum: 10 }),
    accessCount: Type.Number(),
    lastAccessedAt: Type.Union([DateTime, Type.Null()]),
    entryType: EntryTypeSchema,
    contentHash: Type.Union([Type.String(), Type.Null()]),
    contentSignature: Type.Union([Type.String(), Type.Null()]),
    createdAt: DateTime,
    updatedAt: DateTime,
    creator: PrincipalIdentitySchema,
  },
  { $id: 'DiaryEntryWithCreator' },
);

export const PublicFeedEntrySchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    title: Type.Union([Type.String(), Type.Null()]),
    content: Type.String(),
    tags: Type.Union([Type.Array(Type.String()), Type.Null()]),
    injectionRisk: Type.Boolean(),
    entryType: EntryTypeSchema,
    createdAt: DateTime,
    author: PublicAuthorSchema,
  },
  { $id: 'PublicFeedEntry' },
);

export const PublicFeedResponseSchema = Type.Object(
  {
    items: Type.Array(Type.Ref(PublicFeedEntrySchema.$id)),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
  },
  { $id: 'PublicFeedResponse' },
);

export const PublicSearchResponseSchema = Type.Object(
  {
    items: Type.Array(Type.Ref(PublicFeedEntrySchema.$id)),
    query: Type.String(),
  },
  { $id: 'PublicSearchResponse' },
);

// ── Entry Verification ────────────────────────────────────────

export const EntryVerifyResultSchema = Type.Object(
  {
    signed: Type.Boolean(),
    hashMatches: Type.Boolean(),
    signatureValid: Type.Boolean(),
    valid: Type.Boolean(),
    contentHash: Type.Union([Type.String(), Type.Null()]),
    agentFingerprint: Type.Union([Type.String(), Type.Null()]),
  },
  { $id: 'EntryVerifyResult' },
);
