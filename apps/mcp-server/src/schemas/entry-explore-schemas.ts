import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

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
  map: Type.Optional(
    Type.Object(
      {
        diaryName: Type.Optional(Type.String()),
        totalEntries: Type.Optional(Type.Integer()),
        sampledEntries: Type.Optional(Type.Integer()),
        overview: Type.Optional(Type.String()),
        zones: Type.Optional(Type.Array(Type.Unknown())),
      },
      {
        additionalProperties: true,
        description:
          'Optional fully-formed diary map (overview + labeled zones) for the app to ' +
          'render immediately. Pass this when you have already interpreted the diary ' +
          'and want first paint to show zones without a follow-up push. Omit it to ' +
          'have the app open in its "waiting for interpretation" state.',
      },
    ),
  ),
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
  zones: Type.Optional(Type.Array(Type.Unknown())),
  tools: Type.Array(Type.String()),
});
export type EntryMapOpenOutput = Static<typeof EntryMapOpenOutputSchema>;
