import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

import {
  EntryTypeSchema,
  FingerprintSchema,
  PublicKeySchema,
  TimestampSchema,
  UuidSchema,
} from './schemas.js';

export const ProvenanceGraphNodeKindSchema = Type.Union([
  Type.Literal('pack'),
  Type.Literal('entry'),
]);

export const ProvenanceGraphEdgeKindSchema = Type.Union([
  Type.Literal('includes'),
  Type.Literal('supersedes'),
]);

export const ProvenanceGraphPackMetaSchema = Type.Object({
  packId: UuidSchema,
  diaryId: UuidSchema,
  packCid: Type.String(),
  packType: Type.String(),
  packCodec: Type.String(),
  pinned: Type.Boolean(),
  createdAt: TimestampSchema,
  expiresAt: Type.Union([TimestampSchema, Type.Null()]),
  supersedesPackId: Type.Union([UuidSchema, Type.Null()]),
});

export const ProvenanceGraphCreatorSchema = Type.Object({
  identityId: UuidSchema,
  fingerprint: FingerprintSchema,
  publicKey: PublicKeySchema,
});

export const ProvenanceGraphEntryMetaSchema = Type.Object({
  entryId: UuidSchema,
  diaryId: UuidSchema,
  entryType: EntryTypeSchema,
  contentHash: Type.Union([Type.String(), Type.Null()]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  signed: Type.Boolean(),
  title: Type.Union([Type.String(), Type.Null()]),
  tags: Type.Array(Type.String()),
  creator: Type.Optional(
    Type.Union([ProvenanceGraphCreatorSchema, Type.Null()]),
  ),
});

export const ProvenanceGraphPackNodeSchema = Type.Object({
  id: Type.String(),
  kind: Type.Literal('pack'),
  label: Type.String(),
  cid: Type.Union([Type.String(), Type.Null()]),
  meta: Type.Composite([
    ProvenanceGraphPackMetaSchema,
    Type.Object({
      creator: Type.Optional(
        Type.Union([ProvenanceGraphCreatorSchema, Type.Null()]),
      ),
    }),
  ]),
});

export const ProvenanceGraphEntryNodeSchema = Type.Object({
  id: Type.String(),
  kind: Type.Literal('entry'),
  label: Type.String(),
  cid: Type.Union([Type.String(), Type.Null()]),
  meta: ProvenanceGraphEntryMetaSchema,
});

export const ProvenanceGraphNodeSchema = Type.Union([
  ProvenanceGraphPackNodeSchema,
  ProvenanceGraphEntryNodeSchema,
]);

export const ProvenanceGraphEdgeSchema = Type.Object({
  id: Type.String(),
  from: Type.String(),
  to: Type.String(),
  kind: ProvenanceGraphEdgeKindSchema,
  label: Type.Optional(Type.String()),
  meta: Type.Optional(
    Type.Record(
      Type.String(),
      Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]),
    ),
  ),
});

export const ProvenanceGraphMetadataSchema = Type.Object({
  format: Type.Literal('moltnet.provenance-graph/v1'),
  generatedAt: TimestampSchema,
  rootNodeId: Type.String(),
  rootPackId: UuidSchema,
  depth: Type.Number({ minimum: 0 }),
});

export const ProvenanceGraphSchema = Type.Object(
  {
    metadata: ProvenanceGraphMetadataSchema,
    nodes: Type.Array(ProvenanceGraphNodeSchema),
    edges: Type.Array(ProvenanceGraphEdgeSchema),
  },
  { $id: 'ProvenanceGraph' },
);

export type ProvenanceGraphNodeKind = Static<
  typeof ProvenanceGraphNodeKindSchema
>;
export type ProvenanceGraphEdgeKind = Static<
  typeof ProvenanceGraphEdgeKindSchema
>;
export type ProvenanceGraphPackMeta = Static<
  typeof ProvenanceGraphPackMetaSchema
>;
export type ProvenanceGraphCreator = Static<
  typeof ProvenanceGraphCreatorSchema
>;
export type ProvenanceGraphEntryMeta = Static<
  typeof ProvenanceGraphEntryMetaSchema
>;
export type ProvenanceGraphNode = Static<typeof ProvenanceGraphNodeSchema>;
export type ProvenanceGraphEdge = Static<typeof ProvenanceGraphEdgeSchema>;
export type ProvenanceGraphMetadata = Static<
  typeof ProvenanceGraphMetadataSchema
>;
export type ProvenanceGraph = Static<typeof ProvenanceGraphSchema>;
