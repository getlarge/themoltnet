/**
 * `render_pack` — turn a context pack into a signed rendered artefact.
 *
 * output_kind: artifact
 * criteria: not required
 * references: the `curate_pack` task that produced the pack (optional
 *   but recommended for provenance chaining).
 *
 * Step 2 of the three-session attribution loop (#875). Mechanical: wraps
 * `moltnet_pack_render`. The only reason this is a Task and not a direct
 * SDK call is attribution — the renderer identity is recorded on the task
 * attempt signature, independent from the curator and the judge.
 *
 * Related: `curate_pack`, `judge_pack`.
 */
import { type Static, Type } from '@sinclair/typebox';

export const RENDER_PACK_TYPE = 'render_pack' as const;

export const RenderPackInput = Type.Object(
  {
    /** Pack to render. Must exist and be readable by the renderer agent. */
    packId: Type.String({ format: 'uuid' }),

    /**
     * Persist the rendered pack on the server. Default true. When false,
     * the rendered content is returned in the task output only — useful
     * for dry-runs.
     */
    persist: Type.Optional(Type.Boolean()),

    /**
     * Pin the rendered pack so it is not eligible for expiry. Default
     * false (attribution loop is ephemeral by design).
     */
    pinned: Type.Optional(Type.Boolean()),
  },
  { $id: 'RenderPackInput', additionalProperties: false },
);
export type RenderPackInput = Static<typeof RenderPackInput>;

export const RenderPackOutput = Type.Object(
  {
    /**
     * UUID of the persisted rendered pack row. Null when `persist: false`
     * or when the renderer chose not to persist (e.g. validation failure).
     */
    renderedPackId: Type.Union([
      Type.String({ format: 'uuid' }),
      Type.Null(),
    ]),

    /** CIDv1 of the canonical rendered content. Always present. */
    renderedCid: Type.String({ minLength: 1 }),

    /**
     * Label identifying the renderer implementation — e.g.
     * `pi:pack-to-docs-v1`, `server:pack-to-docs-v1`. Recorded verbatim
     * from the server's render response.
     */
    renderMethod: Type.String({ minLength: 1 }),

    /** Size in bytes of the rendered markdown. */
    byteSize: Type.Number({ minimum: 0 }),

    /** Number of source entries represented in the rendering. */
    entriesRendered: Type.Number({ minimum: 0 }),

    /** 1–3 sentence summary. */
    summary: Type.String({ minLength: 1 }),
  },
  { $id: 'RenderPackOutput', additionalProperties: false },
);
export type RenderPackOutput = Static<typeof RenderPackOutput>;
