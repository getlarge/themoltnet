import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

/**
 * One search that contributed entries to a zone — recorded for reproducibility
 * and carried into the pack `params` when a zone is saved. snake_case is the
 * canonical wire shape (the app maps it to its camelCase internal type).
 */
export const EntryMapZoneSearchSchema = Type.Object({
  query: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String())),
  exclude_tags: Type.Optional(Type.Array(Type.String())),
  entry_types: Type.Optional(Type.Array(Type.String())),
  weights: Type.Optional(
    Type.Object({
      relevance: Type.Optional(Type.Number()),
      recency: Type.Optional(Type.Number()),
      importance: Type.Optional(Type.Number()),
    }),
  ),
});
export type EntryMapZoneSearch = Static<typeof EntryMapZoneSearchSchema>;

export const EntryMapZoneProvenanceSchema = Type.Object({
  basis: Type.Optional(
    Type.String({
      description: 'Human-language selection basis, e.g. "tag:auth + recent".',
    }),
  ),
  searches: Type.Optional(
    Type.Array(EntryMapZoneSearchSchema, {
      description:
        'The searches that produced this zone (for reproducibility).',
    }),
  ),
});

/**
 * A single agent-interpreted knowledge zone in the diary map.
 *
 * This schema is the CONTRACT with the interpreting agent: it must be explicit
 * enough that the model knows exactly which fields to send (especially that
 * `entry_ids` carries REAL entry UUIDs, not labels). A prior opaque
 * `Array(Unknown)` let the agent invent field names (`anchorEntries`, `summary`)
 * that the app silently dropped, rendering every zone with zero entries.
 */
export const EntryMapZoneSchema = Type.Object({
  id: Type.String({
    description: 'Stable zone id (any unique slug, e.g. "infra-decisions").',
  }),
  label: Type.String({
    description: 'Short human-language zone title shown on the card.',
  }),
  why: Type.Optional(
    Type.String({
      description:
        'One sentence explaining why these entries belong together (the card subtitle).',
    }),
  ),
  entry_ids: Type.Array(Type.String(), {
    description:
      'REQUIRED. The actual entry UUIDs that belong to this zone — copy them ' +
      'verbatim from the `id` field of entries_list / entries_search results. ' +
      "These populate the zone's entry mosaic; an empty array renders an empty " +
      'zone. Do NOT put titles, tags, or labels here.',
  }),
  territory: Type.Optional(
    Type.String({
      description:
        'Optional governing tag/namespace for the zone, e.g. "scope:infra".',
    }),
  ),
  tags: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Optional representative tags for the zone.',
    }),
  ),
  size: Type.Optional(
    Type.Integer({
      description:
        'Optional approximate total entries in this zone (may exceed entry_ids.length when sampled).',
    }),
  ),
  provenance: Type.Optional(EntryMapZoneProvenanceSchema),
});
export type EntryMapZone = Static<typeof EntryMapZoneSchema>;

export const EntryMapDataSchema = Type.Object(
  {
    diaryName: Type.Optional(Type.String()),
    totalEntries: Type.Optional(Type.Integer()),
    sampledEntries: Type.Optional(Type.Integer()),
    overview: Type.Optional(
      Type.String({
        description:
          "1-3 sentence orientation shown on first paint ('your diary has N zones …').",
      }),
    ),
    zones: Type.Optional(
      Type.Array(EntryMapZoneSchema, {
        description: 'The interpreted knowledge zones, 3-8 recommended.',
      }),
    ),
  },
  {
    description:
      'Fully-formed diary map (overview + typed zones) for the app to render ' +
      'immediately. Each zone MUST include real entry_ids (entry UUIDs). Omit ' +
      'the whole map to open in the "waiting for interpretation" state.',
  },
);

/**
 * Input for `entries_map_open` — the thin opener that mounts the diary map MCP
 * app. The tool is intentionally deterministic: it echoes these inputs into a
 * structured output and declares the read/packs tools the app may call. All
 * interpretation (sampling, zone discovery, labeling) happens in the client
 * agent, not here.
 */
export const EntryMapOpenSchema = Type.Object({
  diary_id: Type.String({
    description:
      'Diary identifier (UUID) to explore as a map of knowledge zones.',
  }),
  sample_limit: Type.Optional(
    Type.Integer({
      minimum: 50,
      maximum: 150,
      description:
        'Suggested number of entries the agent should sample to interpret the diary. Default 96.',
    }),
  ),
  framing: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 500,
      description:
        'Optional one-sentence framing of what the user wants to find or be reminded of.',
    }),
  ),
  map: Type.Optional(EntryMapDataSchema),
});
export type EntryMapOpenInput = Static<typeof EntryMapOpenSchema>;

export const EntryMapOpenOutputSchema = Type.Object({
  app: Type.Literal('moltnet_entry_explore'),
  resourceUri: Type.String(),
  diaryId: Type.String(),
  sampleLimit: Type.Integer(),
  framing: Type.Optional(Type.String()),
  /** Echoes a caller-supplied map so the app can render zones on first paint. */
  diaryName: Type.Optional(Type.String()),
  totalEntries: Type.Optional(Type.Integer()),
  sampledEntries: Type.Optional(Type.Integer()),
  overview: Type.Optional(Type.String()),
  zones: Type.Optional(Type.Array(EntryMapZoneSchema)),
  tools: Type.Array(Type.String()),
});
export type EntryMapOpenOutput = Static<typeof EntryMapOpenOutputSchema>;
