/**
 * `curate_pack` — select and rank diary entries into a context pack.
 *
 * output_kind: artifact
 * criteria: not required (rubric-less curation recipe)
 * references: optional (e.g. a prior rendered pack being re-curated)
 *
 * This is step 1 of the three-session attribution loop (#875). The agent
 * runs a structured exploration over a diary — tag inventory, hybrid
 * search, type/tag narrowing — and emits a ranked entry list via
 * `moltnet_pack_create`. The prompt is deterministic given the input
 * (no operator interaction), so two runs with the same input should
 * converge on similar packs.
 *
 * Related: `render_pack`, `judge_pack`.
 */
import { type Static, Type } from '@sinclair/typebox';

export const CURATE_PACK_TYPE = 'curate_pack' as const;

export const EntryTypeFilter = Type.Union([
  Type.Literal('episodic'),
  Type.Literal('semantic'),
  Type.Literal('procedural'),
  Type.Literal('reflection'),
]);

export const CuratePackInput = Type.Object(
  {
    /** The diary to curate from. Usually the agent's session diary. */
    diary_id: Type.String({ format: 'uuid' }),

    /**
     * Free-text prompt describing the desired pack. Seeds hybrid search
     * and feeds the model's ranking reasoning. e.g.
     * "incidents and workarounds related to CI pipelines".
     */
    task_prompt: Type.String({ minLength: 1 }),

    /**
     * Restrict search to these entry types. Defaults to the
     * knowledge-bearing set: ['semantic','episodic','procedural'].
     */
    entry_types: Type.Optional(Type.Array(EntryTypeFilter, { minItems: 1 })),

    /**
     * Tag filters applied after candidate discovery.
     *  - `include`: candidate entries must carry ALL listed tags.
     *  - `exclude`: drop entries carrying ANY listed tag.
     *  - `prefix`: when listing tags via `moltnet_diary_tags`, narrow to
     *    tags starting with this prefix (e.g. 'scope:').
     */
    tag_filters: Type.Optional(
      Type.Object(
        {
          include: Type.Optional(Type.Array(Type.String())),
          exclude: Type.Optional(Type.Array(Type.String())),
          prefix: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),

    /**
     * Soft token budget passed through to `packs_create`. Acts as a
     * constraint, not a target — the curator picks entry count such that
     * the resulting pack fits under this budget.
     */
    token_budget: Type.Optional(Type.Number({ minimum: 500 })),

    /**
     * Curation recipe identifier. Recorded on the pack's `params` for
     * provenance. The runtime picks a prompt variant by recipe; unknown
     * recipes fall back to the default.
     */
    recipe: Type.Optional(
      Type.Union([
        Type.Literal('topic-focused-v1'),
        Type.Literal('scope-inventory-v1'),
      ]),
    ),
  },
  { $id: 'CuratePackInput', additionalProperties: false },
);
export type CuratePackInput = Static<typeof CuratePackInput>;

/**
 * Index of the curated pack plus the reasoning trace. The pack itself
 * lives in the database (created via `moltnet_pack_create`); this output
 * is the receipt.
 */
export const CuratePackOutput = Type.Object(
  {
    /** UUID of the created pack row. */
    pack_id: Type.String({ format: 'uuid' }),

    /** CIDv1 of the pack's canonical content, as returned by the server. */
    pack_cid: Type.String({ minLength: 1 }),

    /** Ordered entry selection (lowest rank = most prominent). */
    entries: Type.Array(
      Type.Object(
        {
          entry_id: Type.String({ format: 'uuid' }),
          rank: Type.Number({ minimum: 1 }),
          /** Short phrase explaining why this entry earned its rank. */
          rationale: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),

    /** Free-form recipe metadata mirrored onto the pack's `params`. */
    recipe_params: Type.Record(Type.String(), Type.Unknown()),

    /**
     * Intermediate exploration snapshots the curator chose to emit.
     * Populated when the task runs a multi-phase exploration — each
     * checkpoint compresses the state the curator carries into the next
     * phase, so a follow-up session can resume from it without replaying
     * the full tool-call history. Always safe to leave empty for small
     * packs.
     */
    checkpoints: Type.Optional(
      Type.Array(
        Type.Object(
          {
            phase: Type.String({ minLength: 1 }),
            candidate_ids: Type.Array(Type.String({ format: 'uuid' })),
            dropped_ids: Type.Optional(
              Type.Array(Type.String({ format: 'uuid' })),
            ),
            notes: Type.String({ minLength: 1 }),
          },
          { additionalProperties: false },
        ),
      ),
    ),

    /** 2–4 sentence narrative of the curation reasoning. */
    summary: Type.String({ minLength: 1 }),
  },
  { $id: 'CuratePackOutput', additionalProperties: false },
);
export type CuratePackOutput = Static<typeof CuratePackOutput>;
