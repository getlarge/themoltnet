import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

const ExploreSuggestedDirectionSchema = Type.Object({
  label: Type.String({
    minLength: 1,
    maxLength: 160,
    description: 'Human-readable exploration direction label.',
  }),
  why: Type.String({
    minLength: 1,
    maxLength: 500,
    description: 'Short explanation for why this direction is interesting.',
  }),
});

const ExploreSelectionBasisSchema = Type.Object({
  description: Type.String({
    minLength: 1,
    maxLength: 1000,
    description:
      'Lightweight provenance for how the current visible set was selected.',
  }),
  queries: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  included_tags: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  excluded_tags: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
});

export const EntryExploreOpenSchema = Type.Object({
  diary_id: Type.String({
    description: 'Diary identifier (UUID) to explore visually.',
  }),
  sample_limit: Type.Optional(
    Type.Integer({
      minimum: 24,
      maximum: 120,
      description: 'How many entries to sample initially. Default 72.',
    }),
  ),
  orientation_summary: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 500,
      description:
        'Optional one-sentence framing of what the agent believes is in the diary.',
    }),
  ),
  suggested_directions: Type.Optional(
    Type.Array(ExploreSuggestedDirectionSchema, {
      minItems: 1,
      maxItems: 5,
      description:
        'Optional human-readable directions to show from the first render.',
    }),
  ),
  visible_entry_ids: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      maxItems: 120,
      description:
        'Optional snapshot of entry ids to render first for a guided exploration view.',
    }),
  ),
  selection_basis: Type.Optional(ExploreSelectionBasisSchema),
});
export type EntryExploreOpenInput = Static<typeof EntryExploreOpenSchema>;

export const EntryExploreRefineSchema = Type.Object({
  exploration_id: Type.String({
    description:
      'Transient exploration identifier returned by entries_explore_open.',
  }),
  query: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 500,
      description:
        'Natural-language refinement query. Use this for LLM-assisted narrowing around a theme or idea.',
    }),
  ),
  include_tag: Type.Optional(
    Type.String({
      description: 'Narrow to entries containing this tag.',
    }),
  ),
  entry_type: Type.Optional(
    Type.Union([
      Type.Literal('episodic'),
      Type.Literal('semantic'),
      Type.Literal('procedural'),
      Type.Literal('reflection'),
      Type.Literal('identity'),
      Type.Literal('soul'),
    ]),
  ),
  reset: Type.Optional(
    Type.Boolean({
      description: 'Reset to the initial sampled entry set.',
    }),
  ),
});
export type EntryExploreRefineInput = Static<typeof EntryExploreRefineSchema>;

export const EntryExploreOutputSchema = Type.Object({
  exploration_id: Type.String(),
  diary_id: Type.String(),
  diary_name: Type.String(),
  surface_html: Type.String(),
  surface_state: Type.Object({
    explorationId: Type.String(),
    diaryId: Type.String(),
    diaryName: Type.String(),
    estimatedEntryCount: Type.Integer(),
    sampleCount: Type.Integer(),
    orientationSummary: Type.Union([Type.String(), Type.Null()]),
    suggestedDirections: Type.Array(ExploreSuggestedDirectionSchema),
    selectionBasis: Type.Union([
      Type.Object({
        description: Type.String(),
        queries: Type.Optional(Type.Array(Type.String())),
        includedTags: Type.Optional(Type.Array(Type.String())),
        excludedTags: Type.Optional(Type.Array(Type.String())),
      }),
      Type.Null(),
    ]),
    queryState: Type.Object({
      query: Type.Union([Type.String(), Type.Null()]),
      includeTag: Type.Union([Type.String(), Type.Null()]),
      entryType: Type.Union([
        Type.Literal('episodic'),
        Type.Literal('semantic'),
        Type.Literal('procedural'),
        Type.Literal('reflection'),
        Type.Literal('identity'),
        Type.Literal('soul'),
        Type.Null(),
      ]),
    }),
    visibleEntries: Type.Array(
      Type.Object({
        id: Type.String(),
        title: Type.Union([Type.String(), Type.Null()]),
        content: Type.String(),
        createdAt: Type.String(),
        entryType: Type.Union([
          Type.Literal('episodic'),
          Type.Literal('semantic'),
          Type.Literal('procedural'),
          Type.Literal('reflection'),
          Type.Literal('identity'),
          Type.Literal('soul'),
        ]),
        importance: Type.Number(),
        tags: Type.Union([Type.Array(Type.String()), Type.Null()]),
      }),
    ),
    topTags: Type.Array(
      Type.Object({
        tag: Type.String(),
        count: Type.Integer(),
      }),
    ),
    pivots: Type.Array(
      Type.Object({
        id: Type.String(),
        label: Type.String(),
        description: Type.String(),
        action: Type.Object({
          kind: Type.String(),
          value: Type.String(),
        }),
      }),
    ),
    clusters: Type.Array(
      Type.Object({
        id: Type.String(),
        label: Type.String(),
        description: Type.String(),
        tag: Type.String(),
        entryIds: Type.Array(Type.String()),
      }),
    ),
    timeline: Type.Array(
      Type.Object({
        id: Type.String(),
        label: Type.String(),
        count: Type.Integer(),
      }),
    ),
  }),
});
export type EntryExploreOutput = Static<typeof EntryExploreOutputSchema>;
