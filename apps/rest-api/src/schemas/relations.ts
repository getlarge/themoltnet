import { type Static, Type } from 'typebox';

import { DateTime } from './atoms.js';

// ── Entry Relations ────────────────────────────────────────

export const RelationTypeSchema = Type.Union(
  [
    Type.Literal('supersedes'),
    Type.Literal('elaborates'),
    Type.Literal('contradicts'),
    Type.Literal('supports'),
    Type.Literal('caused_by'),
    Type.Literal('references'),
  ],
  { $id: 'RelationType' },
);
export type RelationType = Static<typeof RelationTypeSchema>;

export const RelationStatusSchema = Type.Union(
  [
    Type.Literal('proposed'),
    Type.Literal('accepted'),
    Type.Literal('rejected'),
  ],
  { $id: 'RelationStatus' },
);
export type RelationStatus = Static<typeof RelationStatusSchema>;

export const EntryRelationSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    sourceId: Type.String({ format: 'uuid' }),
    targetId: Type.String({ format: 'uuid' }),
    relation: Type.Unsafe<RelationType>(Type.Ref(RelationTypeSchema.$id)),
    status: Type.Unsafe<RelationStatus>(Type.Ref(RelationStatusSchema.$id)),
    sourceCidSnapshot: Type.Union([Type.String(), Type.Null()]),
    targetCidSnapshot: Type.Union([Type.String(), Type.Null()]),
    workflowId: Type.Union([Type.String(), Type.Null()]),
    confidence: Type.Union([Type.Number(), Type.Null()]),
    similarity: Type.Union([Type.Number(), Type.Null()]),
    createdAt: DateTime,
    updatedAt: DateTime,
  },
  { $id: 'EntryRelation' },
);

export const EntryRelationListSchema = Type.Object(
  {
    items: Type.Array(Type.Ref(EntryRelationSchema.$id)),
    total: Type.Number({
      description: 'Total number of matching items in the database.',
    }),
    limit: Type.Number({
      description: 'Maximum number of items requested.',
    }),
    offset: Type.Number({
      description: 'Number of items skipped before this page.',
    }),
  },
  { $id: 'EntryRelationList' },
);

// ── Expanded Relations (depth traversal) ───────────────────

export const EntryRelationWithDepthSchema = Type.Intersect(
  [
    EntryRelationSchema,
    Type.Object({
      depth: Type.Integer({
        minimum: 1,
        description: 'BFS depth from the origin entry (1 = direct).',
      }),
      parentRelationId: Type.Union([
        Type.String({ format: 'uuid' }),
        Type.Null(),
      ]),
    }),
  ],
  { $id: 'EntryRelationWithDepth' },
);

export const ExpandedRelationsSchema = Type.Object(
  {
    requestedDepth: Type.Integer({ minimum: 1, maximum: 3 }),
    maxDepth: Type.Integer({
      minimum: 0,
      maximum: 3,
      description: 'Server-side depth cap.',
    }),
    items: Type.Array(Type.Ref(EntryRelationWithDepthSchema.$id)),
  },
  { $id: 'ExpandedRelations' },
);
