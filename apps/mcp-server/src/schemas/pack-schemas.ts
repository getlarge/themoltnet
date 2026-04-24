/**
 * Context pack MCP tool input schemas.
 *
 * Covers: packs_get/list/preview/create/provenance/update/diff,
 * rendered pack update, and render/render_preview.
 */

import type {
  CreateDiaryCustomPackData,
  CreateDiaryCustomPackResponses,
  DiffContextPacksByCidResponses,
  DiffContextPacksByIdResponses,
  GetContextPackByIdData,
  GetContextPackByIdResponses,
  GetContextPackProvenanceByCidData,
  GetContextPackProvenanceByCidResponses,
  GetContextPackProvenanceByIdData,
  GetContextPackProvenanceByIdResponses,
  ListContextPacksData,
  ListContextPacksResponses,
  ListDiaryPacksData,
  PreviewDiaryCustomPackData,
  PreviewDiaryCustomPackResponses,
  PreviewRenderedPackData,
  PreviewRenderedPackResponses,
  RenderContextPackData,
  RenderContextPackResponses,
  UpdateContextPackData,
  UpdateContextPackResponses,
  UpdateRenderedPackData,
  UpdateRenderedPackResponses,
} from '@moltnet/api-client';
import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

import type {
  AssertOutputMatchesApi,
  AssertSchemaToApi,
  BodyOf,
  PathOf,
  ResponseOf,
} from './common.js';

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
  diary_id: Type.Optional(
    Type.String({
      description:
        'Diary ID (UUID) to list packs for. Mutually exclusive with contains_entry.',
    }),
  ),
  contains_entry: Type.Optional(
    Type.String({
      description:
        'Entry identifier (UUID) to reverse-lookup packs for. Mutually exclusive with diary_id.',
    }),
  ),
  include_rendered: Type.Optional(
    Type.Boolean({
      description:
        'When using contains_entry, include rendered packs derived from the matching source packs.',
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: 'Max results (default 20)' }),
  ),
  offset: Type.Optional(
    Type.Number({ description: 'Offset for pagination (default 0)' }),
  ),
  expand: Type.Optional(
    Type.Literal('entries', {
      description: 'Pass entries to include the full entry list in each pack.',
    }),
  ),
});
type ListDiaryQuery = NonNullable<ListDiaryPacksData['query']>;
type ListContextQuery = NonNullable<ListContextPacksData['query']>;
export type PackListInput = {
  diary_id?: PathOf<ListDiaryPacksData>['id'];
  contains_entry?: ListContextQuery['containsEntry'];
  include_rendered?: ListContextQuery['includeRendered'];
  limit?: ListDiaryQuery['limit'];
  offset?: ListDiaryQuery['offset'];
  expand?: ListDiaryQuery['expand'];
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

export const RenderedPackUpdateSchema = Type.Object({
  rendered_pack_id: Type.String({
    description: 'Rendered pack ID (UUID) to update.',
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
  verified_task_id: Type.Optional(
    Type.String({
      description:
        'ID of a completed judge_pack task on the same diary that verified this rendered pack.',
    }),
  ),
});
export type RenderedPackUpdateInput = {
  rendered_pack_id: PathOf<UpdateRenderedPackData>['id'];
  pinned?: NonNullable<BodyOf<UpdateRenderedPackData>>['pinned'];
  expires_at?: NonNullable<BodyOf<UpdateRenderedPackData>>['expiresAt'];
  verified_task_id?: NonNullable<
    BodyOf<UpdateRenderedPackData>
  >['verifiedTaskId'];
};

export const PackRenderSchema = Type.Object({
  pack_id: Type.String({
    description: 'Source context pack UUID to render',
  }),
  rendered_markdown: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 500_000,
      description:
        'The rendered markdown content. Omit this when render_method starts with "server:".',
    }),
  ),
  render_method: Type.String({
    minLength: 1,
    maxLength: 100,
    description:
      'Render method label, e.g. "server:pack-to-docs-v1", "agent-refined"',
  }),
  pinned: Type.Optional(
    Type.Boolean({
      description: 'Pin the rendered pack to protect from GC',
    }),
  ),
});
export type PackRenderInput = {
  pack_id: PathOf<RenderContextPackData>['id'];
  rendered_markdown?: BodyOf<RenderContextPackData>['renderedMarkdown'];
  render_method: NonNullable<BodyOf<RenderContextPackData>>['renderMethod'];
  pinned?: NonNullable<BodyOf<RenderContextPackData>>['pinned'];
};

export const PackRenderPreviewSchema = Type.Object({
  pack_id: Type.String({
    description: 'Source context pack UUID to preview',
  }),
  rendered_markdown: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 500_000,
      description:
        'The rendered markdown content. Omit this when render_method starts with "server:".',
    }),
  ),
  render_method: Type.String({
    minLength: 1,
    maxLength: 100,
    description:
      'Render method label, e.g. "server:pack-to-docs-v1", "agent-refined"',
  }),
});
export type PackRenderPreviewInput = {
  pack_id: PathOf<PreviewRenderedPackData>['id'];
  rendered_markdown?: BodyOf<PreviewRenderedPackData>['renderedMarkdown'];
  render_method: NonNullable<BodyOf<PreviewRenderedPackData>>['renderMethod'];
};

// --- Output schemas ---

const AgentIdentitySchema = Type.Object({
  identityId: Type.String(),
  fingerprint: Type.String(),
  publicKey: Type.String(),
});

const PackTypeSchema = Type.Union([
  Type.Literal('compile'),
  Type.Literal('optimized'),
  Type.Literal('custom'),
]);

const CompressionLevelSchema = Type.Union([
  Type.Literal('full'),
  Type.Literal('summary'),
  Type.Literal('keywords'),
]);

const EntryTypeLiteralSchema = Type.Union([
  Type.Literal('episodic'),
  Type.Literal('semantic'),
  Type.Literal('procedural'),
  Type.Literal('reflection'),
  Type.Literal('identity'),
  Type.Literal('soul'),
]);

const DiaryEntryWithCreatorSchema = Type.Object({
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
  creator: Type.Union([AgentIdentitySchema, Type.Null()]),
});

const ExpandedPackEntrySchema = Type.Object({
  id: Type.String(),
  packId: Type.String(),
  entryId: Type.String(),
  entryCidSnapshot: Type.String(),
  compressionLevel: CompressionLevelSchema,
  originalTokens: Type.Union([Type.Number(), Type.Null()]),
  packedTokens: Type.Union([Type.Number(), Type.Null()]),
  rank: Type.Union([Type.Number(), Type.Null()]),
  createdAt: Type.String(),
  entry: DiaryEntryWithCreatorSchema,
});

const ContextPackResponseSchema = Type.Object({
  id: Type.String(),
  diaryId: Type.String(),
  packCid: Type.String(),
  packCodec: Type.String(),
  packType: PackTypeSchema,
  params: Type.Unknown(),
  payload: Type.Unknown(),
  createdBy: Type.String(),
  creator: Type.Union([AgentIdentitySchema, Type.Null()]),
  supersedesPackId: Type.Union([Type.String(), Type.Null()]),
  pinned: Type.Boolean(),
  expiresAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  entries: Type.Optional(Type.Array(ExpandedPackEntrySchema)),
});

const RenderedPackSchema = Type.Object({
  id: Type.String(),
  packCid: Type.String(),
  sourcePackId: Type.String(),
  diaryId: Type.String(),
  contentHash: Type.String(),
  renderMethod: Type.String(),
  totalTokens: Type.Number(),
  createdBy: Type.String(),
  pinned: Type.Boolean(),
  expiresAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
});

export const PackGetOutputSchema = ContextPackResponseSchema;

export const PackListOutputSchema = Type.Object({
  items: Type.Array(ContextPackResponseSchema),
  total: Type.Number(),
  limit: Type.Number(),
  offset: Type.Number(),
  renderedPacks: Type.Optional(Type.Array(RenderedPackSchema)),
});

export const PackUpdateOutputSchema = ContextPackResponseSchema;

const CompileStatsSchema = Type.Object({
  totalTokens: Type.Number(),
  entriesIncluded: Type.Number(),
  entriesCompressed: Type.Number(),
  compressionRatio: Type.Number(),
  budgetUtilization: Type.Number(),
  elapsedMs: Type.Number(),
});

const CustomPackEntryResultSchema = Type.Object({
  entryId: Type.String(),
  entryCidSnapshot: Type.String(),
  rank: Type.Number(),
  compressionLevel: CompressionLevelSchema,
  originalTokens: Type.Number(),
  packedTokens: Type.Number(),
});

const CustomPackResultSchema = Type.Object({
  packCid: Type.String(),
  packType: Type.Literal('custom'),
  params: Type.Record(Type.String(), Type.Unknown()),
  entries: Type.Array(CustomPackEntryResultSchema),
  compileStats: CompileStatsSchema,
});

export const PackPreviewOutputSchema = CustomPackResultSchema;

export const PackCreateOutputSchema = CustomPackResultSchema;

export const PackRenderPreviewOutputSchema = Type.Object({
  sourcePackId: Type.String(),
  sourcePackCid: Type.String(),
  renderMethod: Type.String(),
  renderedMarkdown: Type.String(),
  totalTokens: Type.Number(),
});

export const PackRenderOutputSchema = Type.Object({
  id: Type.String(),
  packCid: Type.String(),
  sourcePackId: Type.String(),
  sourcePackCid: Type.String(),
  diaryId: Type.String(),
  contentHash: Type.String(),
  renderMethod: Type.String(),
  renderedMarkdown: Type.String(),
  totalTokens: Type.Number(),
  pinned: Type.Boolean(),
});

export const RenderedPackUpdateOutputSchema = Type.Object({
  id: Type.String(),
  packCid: Type.String(),
  sourcePackId: Type.String(),
  diaryId: Type.String(),
  content: Type.String(),
  contentHash: Type.String(),
  renderMethod: Type.String(),
  totalTokens: Type.Number(),
  pinned: Type.Boolean(),
  expiresAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
});

const ProvenanceEdgeSchema = Type.Object({
  id: Type.String(),
  from: Type.String(),
  to: Type.String(),
  kind: Type.Union([
    Type.Literal('includes'),
    Type.Literal('supersedes'),
    Type.Literal('rendered_from'),
  ]),
  label: Type.Optional(Type.String()),
  meta: Type.Optional(
    Type.Record(
      Type.String(),
      Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]),
    ),
  ),
});

const ProvenanceCreatorSchema = Type.Object({
  identityId: Type.String(),
  fingerprint: Type.String(),
  publicKey: Type.String(),
});

const ProvenancePackNodeSchema = Type.Object({
  id: Type.String(),
  kind: Type.Literal('pack'),
  label: Type.String(),
  cid: Type.Union([Type.String(), Type.Null()]),
  meta: Type.Object({
    packId: Type.String(),
    diaryId: Type.String(),
    packCid: Type.String(),
    packType: Type.String(),
    packCodec: Type.String(),
    pinned: Type.Boolean(),
    createdAt: Type.String(),
    expiresAt: Type.Union([Type.String(), Type.Null()]),
    supersedesPackId: Type.Union([Type.String(), Type.Null()]),
    creator: Type.Optional(Type.Union([ProvenanceCreatorSchema, Type.Null()])),
  }),
});

const ProvenanceEntryNodeSchema = Type.Object({
  id: Type.String(),
  kind: Type.Literal('entry'),
  label: Type.String(),
  cid: Type.Union([Type.String(), Type.Null()]),
  meta: Type.Object({
    entryId: Type.String(),
    diaryId: Type.String(),
    entryType: EntryTypeLiteralSchema,
    contentHash: Type.Union([Type.String(), Type.Null()]),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    signed: Type.Boolean(),
    title: Type.Union([Type.String(), Type.Null()]),
    tags: Type.Array(Type.String()),
    creator: Type.Optional(Type.Union([ProvenanceCreatorSchema, Type.Null()])),
  }),
});

const ProvenanceRenderedPackNodeSchema = Type.Object({
  id: Type.String(),
  kind: Type.Literal('rendered_pack'),
  label: Type.String(),
  cid: Type.Union([Type.String(), Type.Null()]),
  meta: Type.Object({
    renderedPackId: Type.String(),
    sourcePackId: Type.String(),
    diaryId: Type.String(),
    packCid: Type.String(),
    renderMethod: Type.String(),
    totalTokens: Type.Number(),
    pinned: Type.Boolean(),
    createdAt: Type.String(),
    expiresAt: Type.Union([Type.String(), Type.Null()]),
  }),
});

export const PackProvenanceOutputSchema = Type.Object({
  metadata: Type.Object({
    format: Type.Literal('moltnet.provenance-graph/v1'),
    generatedAt: Type.String(),
    rootNodeId: Type.String(),
    rootPackId: Type.String(),
    depth: Type.Number(),
  }),
  nodes: Type.Array(
    Type.Union([
      ProvenancePackNodeSchema,
      ProvenanceEntryNodeSchema,
      ProvenanceRenderedPackNodeSchema,
    ]),
  ),
  edges: Type.Array(ProvenanceEdgeSchema),
});

export const PackDiffSchema = Type.Object(
  {
    pack_id: Type.Optional(
      Type.String({
        description:
          'Pack A UUID. Use with other_pack_id. Mutually exclusive with pack_cid/other_pack_cid.',
      }),
    ),
    other_pack_id: Type.Optional(
      Type.String({
        description: 'Pack B UUID. Required when pack_id is provided.',
      }),
    ),
    pack_cid: Type.Optional(
      Type.String({
        description:
          'Pack A CID. Use with other_pack_cid. Mutually exclusive with pack_id/other_pack_id.',
      }),
    ),
    other_pack_cid: Type.Optional(
      Type.String({
        description: 'Pack B CID. Required when pack_cid is provided.',
      }),
    ),
  },
  {
    description:
      'Identify both packs by UUID (pack_id + other_pack_id) or by CID (pack_cid + other_pack_cid). Provide exactly one pair — mixed identifier types are not supported.',
  },
);

export type PackDiffInput = Static<typeof PackDiffSchema>;

const PackDiffEntryBaseOutputSchema = Type.Object({
  entryId: Type.String(),
  title: Type.Union([Type.String(), Type.Null()]),
  entryCidSnapshot: Type.String(),
  compressionLevel: CompressionLevelSchema,
  packedTokens: Type.Union([Type.Integer(), Type.Null()]),
});

const PackDiffPackMetaOutputSchema = Type.Object({
  id: Type.String(),
  packCid: Type.String(),
  totalTokens: Type.Union([Type.Integer(), Type.Null()]),
  packType: PackTypeSchema,
  createdAt: Type.String(),
});

export const PackDiffOutputSchema = Type.Object({
  added: Type.Array(
    Type.Composite([
      PackDiffEntryBaseOutputSchema,
      Type.Object({ rank: Type.Integer() }),
    ]),
  ),
  removed: Type.Array(
    Type.Composite([
      PackDiffEntryBaseOutputSchema,
      Type.Object({ rank: Type.Integer() }),
    ]),
  ),
  reordered: Type.Array(
    Type.Composite([
      PackDiffEntryBaseOutputSchema,
      Type.Object({ oldRank: Type.Integer(), newRank: Type.Integer() }),
    ]),
  ),
  changed: Type.Array(
    Type.Object({
      entryId: Type.String(),
      rank: Type.Integer(),
      title: Type.Union([Type.String(), Type.Null()]),
      oldEntryCidSnapshot: Type.String(),
      newEntryCidSnapshot: Type.String(),
      oldCompressionLevel: CompressionLevelSchema,
      newCompressionLevel: CompressionLevelSchema,
      oldPackedTokens: Type.Union([Type.Integer(), Type.Null()]),
      newPackedTokens: Type.Union([Type.Integer(), Type.Null()]),
      tokenDelta: Type.Integer(),
    }),
  ),
  stats: Type.Object({
    addedCount: Type.Integer(),
    removedCount: Type.Integer(),
    reorderedCount: Type.Integer(),
    changedCount: Type.Integer(),
    tokenDelta: Type.Integer(),
    packA: PackDiffPackMetaOutputSchema,
    packB: PackDiffPackMetaOutputSchema,
  }),
});

// --- Compile-time drift checks ---

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
type _PackRenderPreviewInputMatchesSchema = AssertSchemaToApi<
  Static<typeof PackRenderPreviewSchema>,
  PackRenderPreviewInput
>;

type _PackGetOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof PackGetOutputSchema>,
  ResponseOf<GetContextPackByIdResponses>
>;
type _PackListOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof PackListOutputSchema>,
  ResponseOf<ListContextPacksResponses>
>;
type _PackUpdateOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof PackUpdateOutputSchema>,
  ResponseOf<UpdateContextPackResponses>
>;
type _PackPreviewOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof PackPreviewOutputSchema>,
  ResponseOf<PreviewDiaryCustomPackResponses>
>;
type _PackCreateOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof PackCreateOutputSchema>,
  ResponseOf<CreateDiaryCustomPackResponses>
>;
type _PackRenderPreviewOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof PackRenderPreviewOutputSchema>,
  ResponseOf<PreviewRenderedPackResponses>
>;
type _PackRenderOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof PackRenderOutputSchema>,
  ResponseOf<RenderContextPackResponses>
>;
type _RenderedPackUpdateOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof RenderedPackUpdateOutputSchema>,
  ResponseOf<UpdateRenderedPackResponses>
>;
type _PackProvenanceByIdOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof PackProvenanceOutputSchema>,
  ResponseOf<GetContextPackProvenanceByIdResponses>
>;
type _PackProvenanceByCidOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof PackProvenanceOutputSchema>,
  ResponseOf<GetContextPackProvenanceByCidResponses>
>;
type _PackDiffByIdOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof PackDiffOutputSchema>,
  ResponseOf<DiffContextPacksByIdResponses>
>;
type _PackDiffByCidOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof PackDiffOutputSchema>,
  ResponseOf<DiffContextPacksByCidResponses>
>;
