/**
 * Diary-level MCP tool input schemas.
 *
 * Covers: diaries_list/create/get/consolidate/compile.
 */

import type {
  CompileDiaryData,
  ConsolidateDiaryData,
  CreateDiaryData,
  GetDiaryData,
} from '@moltnet/api-client';
import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

import type {
  AssertSchemaToApi,
  BodyOf,
  EmptyInput,
  PathOf,
  SnakeCasedProperties,
} from './common.js';

export const DiariesConsolidateSchema = Type.Object({
  diary_id: Type.String({ description: 'Diary identifier (UUID).' }),
  entry_ids: Type.Optional(Type.Array(Type.String())),
  tags: Type.Optional(Type.Array(Type.String())),
  exclude_tags: Type.Optional(Type.Array(Type.String())),
  threshold: Type.Optional(Type.Number()),
  strategy: Type.Optional(
    Type.Union([
      Type.Literal('score'),
      Type.Literal('centroid'),
      Type.Literal('hybrid'),
    ]),
  ),
});
type ConsolidateDiaryBody = BodyOf<ConsolidateDiaryData>;
export type DiariesConsolidateInput =
  SnakeCasedProperties<ConsolidateDiaryBody> & {
    diary_id: PathOf<ConsolidateDiaryData>['id'];
    exclude_tags?: string[];
  };

export const DiariesCompileSchema = Type.Object({
  diary_id: Type.String({ description: 'Diary identifier (UUID).' }),
  token_budget: Type.Number({ description: 'Maximum token budget.' }),
  task_prompt: Type.Optional(
    Type.String({ description: 'Optional task prompt for relevance scoring.' }),
  ),
  lambda: Type.Optional(Type.Number({ description: 'MMR lambda in [0,1].' })),
  include_tags: Type.Optional(Type.Array(Type.String())),
  exclude_tags: Type.Optional(Type.Array(Type.String())),
  w_recency: Type.Optional(Type.Number()),
  w_importance: Type.Optional(Type.Number()),
  created_before: Type.Optional(
    Type.String({
      format: 'date-time',
      description:
        'ISO-8601 datetime cutoff. Only entries created before this date are included.',
    }),
  ),
  created_after: Type.Optional(
    Type.String({
      format: 'date-time',
      description:
        'ISO-8601 datetime cutoff. Only entries created on or after this date are included.',
    }),
  ),
  entry_types: Type.Optional(
    Type.Array(
      Type.Union([
        Type.Literal('episodic'),
        Type.Literal('semantic'),
        Type.Literal('procedural'),
        Type.Literal('reflection'),
        Type.Literal('identity'),
        Type.Literal('soul'),
      ]),
      {
        description:
          'Filter entries by type. episodic=incidents, semantic=decisions/knowledge, procedural=how-to/commits, reflection=observations, identity=whoami, soul=values.',
      },
    ),
  ),
});
type CompileDiaryBody = BodyOf<CompileDiaryData>;
export type DiariesCompileInput = SnakeCasedProperties<CompileDiaryBody> & {
  diary_id: PathOf<CompileDiaryData>['id'];
  exclude_tags?: string[];
};

// --- Diary catalog schemas ---

export const DiariesListSchema = Type.Object({});
export type DiariesListInput = EmptyInput;

export const DiariesCreateSchema = Type.Object({
  name: Type.String({ description: 'Diary name (1-255 chars)' }),
  visibility: Type.Optional(
    Type.Union(
      [
        Type.Literal('private'),
        Type.Literal('moltnet'),
        Type.Literal('public'),
      ],
      { description: 'Visibility. Default private.' },
    ),
  ),
  team_id: Type.String({
    description: 'Team ID that will own the diary (UUID).',
  }),
});
type CreateDiaryBody = BodyOf<CreateDiaryData>;
export type DiariesCreateInput = CreateDiaryBody & { team_id: string };

export const DiariesGetSchema = Type.Object({
  diary_id: Type.String({ description: 'Diary identifier (UUID).' }),
});
export type DiariesGetInput = { diary_id: PathOf<GetDiaryData>['id'] };

// --- Compile-time drift checks ---

type _DiariesConsolidateInputMatchesSchema = AssertSchemaToApi<
  Static<typeof DiariesConsolidateSchema>,
  DiariesConsolidateInput
>;
type _DiariesCompileInputMatchesSchema = AssertSchemaToApi<
  Static<typeof DiariesCompileSchema>,
  DiariesCompileInput
>;
type _DiariesCreateInputMatchesSchema = AssertSchemaToApi<
  Static<typeof DiariesCreateSchema>,
  DiariesCreateInput
>;
type _DiariesGetInputMatchesSchema = AssertSchemaToApi<
  Static<typeof DiariesGetSchema>,
  DiariesGetInput
>;
