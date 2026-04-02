import { Type } from '@sinclair/typebox';

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

export const RelationStatusSchema = Type.Union(
  [
    Type.Literal('proposed'),
    Type.Literal('accepted'),
    Type.Literal('rejected'),
  ],
  { $id: 'RelationStatus' },
);

export const EntryRelationSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    sourceId: Type.String({ format: 'uuid' }),
    targetId: Type.String({ format: 'uuid' }),
    relation: Type.Ref(RelationTypeSchema),
    status: Type.Ref(RelationStatusSchema),
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
    items: Type.Array(Type.Ref(EntryRelationSchema)),
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

// ── Context Distill ─────────────────────────────────────────

const DistillEntryRefSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  content: Type.String(),
  tokens: Type.Number(),
  importance: Type.Number({ minimum: 1, maximum: 10 }),
  createdAt: DateTime,
});

const ClusterSchema = Type.Object({
  representative: DistillEntryRefSchema,
  representativeReason: Type.String(),
  members: Type.Array(DistillEntryRefSchema),
  similarity: Type.Number({ minimum: 0, maximum: 1 }),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  suggestedAction: Type.Union([
    Type.Literal('merge'),
    Type.Literal('keep_separate'),
    Type.Literal('review'),
  ]),
});

export const ConsolidateResultSchema = Type.Object(
  {
    workflowId: Type.String(),
    clusters: Type.Array(ClusterSchema),
    stats: Type.Object({
      inputCount: Type.Number(),
      clusterCount: Type.Number(),
      singletonRate: Type.Number(),
      clusterSizeDistribution: Type.Tuple([
        Type.Number(),
        Type.Number(),
        Type.Number(),
        Type.Number(),
        Type.Number(),
      ]),
      elapsedMs: Type.Number(),
    }),
    trace: Type.Object({
      thresholdUsed: Type.Number(),
      strategyUsed: Type.Union([
        Type.Literal('score'),
        Type.Literal('centroid'),
        Type.Literal('hybrid'),
      ]),
      embeddingDim: Type.Number(),
    }),
  },
  { $id: 'ConsolidateResult' },
);
