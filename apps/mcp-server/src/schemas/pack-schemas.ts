/**
 * Context pack MCP tool input schemas.
 *
 * Covers: packs_get/list/preview/create/provenance/update,
 * rendered pack update, and render/render_preview.
 */

import type {
  CreateDiaryCustomPackData,
  GetContextPackByIdData,
  GetContextPackProvenanceByCidData,
  GetContextPackProvenanceByIdData,
  ListDiaryPacksData,
  PreviewDiaryCustomPackData,
  PreviewRenderedPackData,
  RenderContextPackData,
  UpdateContextPackData,
  UpdateRenderedPackData,
} from '@moltnet/api-client';
import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

import type { AssertSchemaToApi, BodyOf, PathOf } from './common.js';

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
});
export type RenderedPackUpdateInput = {
  rendered_pack_id: PathOf<UpdateRenderedPackData>['id'];
  pinned?: NonNullable<BodyOf<UpdateRenderedPackData>>['pinned'];
  expires_at?: NonNullable<BodyOf<UpdateRenderedPackData>>['expiresAt'];
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
