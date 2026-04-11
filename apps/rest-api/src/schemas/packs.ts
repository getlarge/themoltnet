import { Type } from '@sinclair/typebox';

import { DateTime } from './atoms.js';
import { AgentIdentitySchema, DiaryEntryWithCreatorSchema } from './diary.js';

// ── Context Packs ─────────────────────────────────────────

export const ContextPackEntrySchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  packId: Type.String({ format: 'uuid' }),
  entryId: Type.String({ format: 'uuid' }),
  entryCidSnapshot: Type.String(),
  compressionLevel: Type.Union([
    Type.Literal('full'),
    Type.Literal('summary'),
    Type.Literal('keywords'),
  ]),
  originalTokens: Type.Union([Type.Number(), Type.Null()]),
  packedTokens: Type.Union([Type.Number(), Type.Null()]),
  rank: Type.Union([Type.Integer(), Type.Null()]),
  createdAt: Type.Unsafe<Date | string>({
    type: 'string',
    format: 'date-time',
  }),
});

export const ExpandedPackEntrySchema = Type.Composite(
  [
    ContextPackEntrySchema,
    Type.Object({
      entry: Type.Ref(DiaryEntryWithCreatorSchema),
    }),
  ],
  { $id: 'ExpandedPackEntry' },
);

export const ContextPackSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    diaryId: Type.String({ format: 'uuid' }),
    packCid: Type.String(),
    packCodec: Type.String(),
    packType: Type.Union([
      Type.Literal('compile'),
      Type.Literal('optimized'),
      Type.Literal('custom'),
    ]),
    params: Type.Unknown(),
    payload: Type.Unknown(),
    createdBy: Type.String({ format: 'uuid' }),
    creator: Type.Union([Type.Ref(AgentIdentitySchema), Type.Null()]),
    supersedesPackId: Type.Union([
      Type.String({ format: 'uuid' }),
      Type.Null(),
    ]),
    pinned: Type.Boolean(),
    expiresAt: Type.Union([
      Type.Unsafe<Date | string>({ type: 'string', format: 'date-time' }),
      Type.Null(),
    ]),
    createdAt: Type.Unsafe<Date | string>({
      type: 'string',
      format: 'date-time',
    }),
  },
  { $id: 'ContextPack' },
);

export const ContextPackExpandedSchema = Type.Composite(
  [
    ContextPackSchema,
    Type.Object({
      entries: Type.Array(Type.Ref(ExpandedPackEntrySchema)),
    }),
  ],
  { $id: 'ContextPackExpanded' },
);

export const ContextPackResponseSchema = Type.Composite(
  [
    ContextPackSchema,
    Type.Object({
      entries: Type.Optional(Type.Array(Type.Ref(ExpandedPackEntrySchema))),
    }),
  ],
  { $id: 'ContextPackResponse' },
);

export const ContextPackListSchema = Type.Object(
  {
    items: Type.Array(Type.Ref(ContextPackSchema)),
    total: Type.Number({
      description: 'Total number of matching items in the database.',
    }),
    limit: Type.Number({
      description: 'Maximum number of items requested for this response.',
    }),
    offset: Type.Number({
      description: 'Number of items skipped before this page.',
    }),
  },
  { $id: 'ContextPackList' },
);

export const ContextPackResponseListSchema = Type.Object(
  {
    items: Type.Array(Type.Ref(ContextPackResponseSchema)),
    total: Type.Number({
      description: 'Total number of matching items in the database.',
    }),
    limit: Type.Number({
      description: 'Maximum number of items requested for this response.',
    }),
    offset: Type.Number({
      description: 'Number of items skipped before this page.',
    }),
  },
  { $id: 'ContextPackResponseList' },
);

export const CompileStatsSchema = Type.Object(
  {
    totalTokens: Type.Number(),
    entriesIncluded: Type.Number(),
    entriesCompressed: Type.Number(),
    compressionRatio: Type.Number(),
    budgetUtilization: Type.Number(),
    elapsedMs: Type.Number(),
  },
  { $id: 'CompileStats' },
);

export const CompileResultSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    diaryId: Type.String({ format: 'uuid' }),
    packCid: Type.String(),
    packCodec: Type.String(),
    packType: Type.Union([
      Type.Literal('compile'),
      Type.Literal('optimized'),
      Type.Literal('custom'),
    ]),
    params: Type.Unknown(),
    payload: Type.Unknown(),
    createdBy: Type.String({ format: 'uuid' }),
    supersedesPackId: Type.Union([
      Type.String({ format: 'uuid' }),
      Type.Null(),
    ]),
    pinned: Type.Boolean(),
    expiresAt: Type.Union([
      Type.Unsafe<Date | string>({ type: 'string', format: 'date-time' }),
      Type.Null(),
    ]),
    createdAt: Type.Unsafe<Date | string>({
      type: 'string',
      format: 'date-time',
    }),
    entries: Type.Array(ContextPackEntrySchema),
    compileStats: Type.Ref(CompileStatsSchema),
    compileTrace: Type.Object({
      lambdaUsed: Type.Number(),
      embeddingDim: Type.Number(),
      taskPromptHash: Type.Optional(Type.String()),
    }),
  },
  { $id: 'CompileResult' },
);

export const CustomPackEntryResultSchema = Type.Object(
  {
    entryId: Type.String({ format: 'uuid' }),
    entryCidSnapshot: Type.String(),
    rank: Type.Integer({ minimum: 1 }),
    compressionLevel: Type.Union([
      Type.Literal('full'),
      Type.Literal('summary'),
      Type.Literal('keywords'),
    ]),
    originalTokens: Type.Number(),
    packedTokens: Type.Number(),
  },
  { $id: 'CustomPackEntryResult' },
);

export const CustomPackResultSchema = Type.Object(
  {
    packCid: Type.String(),
    packType: Type.Literal('custom'),
    params: Type.Record(Type.String(), Type.Unknown()),
    entries: Type.Array(Type.Ref(CustomPackEntryResultSchema)),
    compileStats: Type.Ref(CompileStatsSchema),
  },
  { $id: 'CustomPackResult' },
);

// ── Pack Route Schemas ─────────────────────────────────────

export const PackParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

export const PackQuerySchema = Type.Object({
  expand: Type.Optional(Type.Literal('entries')),
});

export const PackListQuerySchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  expand: Type.Optional(Type.Literal('entries')),
});

export const PackCidParamsSchema = Type.Object({
  cid: Type.String(),
});

export const PackProvenanceQuerySchema = Type.Object({
  depth: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
});

export const CustomPackBodySchema = Type.Object({
  packType: Type.Literal('custom'),
  params: Type.Record(
    Type.String({ minLength: 1, maxLength: 100 }),
    Type.Unknown(),
  ),
  entries: Type.Array(
    Type.Object({
      entryId: Type.String({ format: 'uuid' }),
      rank: Type.Integer({ minimum: 1 }),
    }),
    { minItems: 1, maxItems: 500 },
  ),
  tokenBudget: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000 })),
  pinned: Type.Optional(Type.Boolean()),
});

export const PackUpdateBodySchema = Type.Object(
  {
    pinned: Type.Optional(Type.Boolean()),
    expiresAt: Type.Optional(Type.String({ format: 'date-time' })),
  },
  {
    minProperties: 1,
    description:
      'At least one of pinned or expiresAt must be provided. See route handler for field-combination constraints.',
  },
);

export const RenderedPackUpdateBodySchema = Type.Object(
  {
    pinned: Type.Optional(Type.Boolean()),
    expiresAt: Type.Optional(Type.String({ format: 'date-time' })),
  },
  {
    minProperties: 1,
    description:
      'At least one of pinned or expiresAt must be provided. See route handler for field-combination constraints.',
  },
);

export const RenderPackPreviewBodySchema = Type.Object(
  {
    renderedMarkdown: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 500_000,
        description:
          'Caller-authored markdown. Required unless renderMethod starts with "server:".',
      }),
    ),
    renderMethod: Type.String({
      minLength: 1,
      maxLength: 100,
      description:
        'Render method label. Trusted server render methods start with "server:" and must omit renderedMarkdown.',
      examples: ['server:pack-to-docs-v1', 'agent:pack-to-docs-v1'],
    }),
  },
  {
    additionalProperties: false,
    description:
      'Preview request. For trusted server methods (`server:*`), omit renderedMarkdown and let the server derive markdown from the source pack. For other methods, provide renderedMarkdown explicitly.',
    examples: [
      {
        renderMethod: 'server:pack-to-docs-v1',
      },
      {
        renderMethod: 'agent:pack-to-docs-v1',
        renderedMarkdown: '# Rendered Pack\n',
      },
    ],
  },
);

export const RenderPackBodySchema = Type.Object(
  {
    renderedMarkdown: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 500_000,
        description:
          'Caller-authored markdown. Required unless renderMethod starts with "server:".',
      }),
    ),
    renderMethod: Type.String({
      minLength: 1,
      maxLength: 100,
      description:
        'Render method label. Trusted server render methods start with "server:" and must omit renderedMarkdown.',
      examples: ['server:pack-to-docs-v1', 'agent:pack-to-docs-v1'],
    }),
    pinned: Type.Optional(Type.Boolean()),
  },
  {
    additionalProperties: false,
    description:
      'Render and persist request. For trusted server methods (`server:*`), omit renderedMarkdown and let the server derive markdown from the source pack. For other methods, provide renderedMarkdown explicitly.',
    examples: [
      {
        renderMethod: 'server:pack-to-docs-v1',
      },
      {
        renderMethod: 'agent:pack-to-docs-v1',
        renderedMarkdown: '# Rendered Pack\n',
      },
    ],
  },
);

export const RenderedPackParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

// ── Rendered Packs ─────────────────────────────────────────

export const RenderedPackSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    packCid: Type.String(),
    sourcePackId: Type.String({ format: 'uuid' }),
    diaryId: Type.String({ format: 'uuid' }),
    contentHash: Type.String(),
    renderMethod: Type.String(),
    totalTokens: Type.Integer(),
    createdBy: Type.String({ format: 'uuid' }),
    pinned: Type.Boolean(),
    expiresAt: Type.Union([DateTime, Type.Null()]),
    createdAt: DateTime,
  },
  { $id: 'RenderedPack' },
);

export const RenderedPackListSchema = Type.Object(
  {
    items: Type.Array(Type.Ref(RenderedPackSchema)),
    total: Type.Number({
      description: 'Total number of matching rendered packs.',
    }),
    limit: Type.Number(),
    offset: Type.Number(),
  },
  { $id: 'RenderedPackList' },
);

export const RenderedPackResultSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    packCid: Type.String(),
    sourcePackId: Type.String({ format: 'uuid' }),
    sourcePackCid: Type.String(),
    diaryId: Type.String({ format: 'uuid' }),
    contentHash: Type.String(),
    renderMethod: Type.String(),
    renderedMarkdown: Type.String(),
    totalTokens: Type.Integer(),
    pinned: Type.Boolean(),
  },
  { $id: 'RenderedPackResult' },
);

export const RenderedPackPreviewSchema = Type.Object(
  {
    sourcePackId: Type.String({ format: 'uuid' }),
    sourcePackCid: Type.String(),
    renderMethod: Type.String(),
    renderedMarkdown: Type.String(),
    totalTokens: Type.Integer(),
  },
  { $id: 'RenderedPackPreview' },
);

export const RenderedPackWithContentSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    packCid: Type.String(),
    sourcePackId: Type.String({ format: 'uuid' }),
    diaryId: Type.String({ format: 'uuid' }),
    content: Type.String(),
    contentHash: Type.String(),
    renderMethod: Type.String(),
    totalTokens: Type.Integer(),
    pinned: Type.Boolean(),
    expiresAt: Type.Union([DateTime, Type.Null()]),
    createdAt: DateTime,
  },
  { $id: 'RenderedPackWithContent' },
);
