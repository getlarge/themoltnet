/**
 * Diary-level MCP tool input schemas.
 *
 * Covers: diaries_list/create/get/consolidate/compile.
 */

import type {
  CompileDiaryData,
  CompileDiaryResponses,
  ConsolidateDiaryData,
  ConsolidateDiaryResponses,
  CreateDiaryData,
  CreateDiaryResponses,
  GetDiaryData,
  GetDiaryResponses,
  ListDiariesResponses,
} from '@moltnet/api-client';
import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

import type {
  AssertOutputMatchesApi,
  AssertSchemaToApi,
  BodyOf,
  EmptyInput,
  PathOf,
  ResponseOf,
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

// --- Output schemas ---

const VisibilitySchema = Type.Union([
  Type.Literal('private'),
  Type.Literal('moltnet'),
  Type.Literal('public'),
]);

const DiaryCatalogSchema = Type.Object({
  id: Type.String(),
  createdBy: Type.String(),
  teamId: Type.String(),
  name: Type.String(),
  visibility: VisibilitySchema,
  signed: Type.Boolean(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export const DiariesListOutputSchema = Type.Object({
  items: Type.Array(DiaryCatalogSchema),
});

export const DiariesCreateOutputSchema = DiaryCatalogSchema;

export const DiariesGetOutputSchema = DiaryCatalogSchema;

const ConsolidateClusterMemberSchema = Type.Object({
  id: Type.String(),
  content: Type.String(),
  tokens: Type.Number(),
  importance: Type.Number(),
  createdAt: Type.String(),
});

const ConsolidateClusterSchema = Type.Object({
  representative: ConsolidateClusterMemberSchema,
  representativeReason: Type.String(),
  members: Type.Array(ConsolidateClusterMemberSchema),
  similarity: Type.Number(),
  confidence: Type.Number(),
  suggestedAction: Type.Union([
    Type.Literal('merge'),
    Type.Literal('keep_separate'),
    Type.Literal('review'),
  ]),
});

export const DiariesConsolidateOutputSchema = Type.Object({
  workflowId: Type.String(),
  clusters: Type.Array(ConsolidateClusterSchema),
  stats: Type.Object({
    inputCount: Type.Number(),
    clusterCount: Type.Number(),
    singletonRate: Type.Number(),
    clusterSizeDistribution: Type.Tuple([
      Type.Unknown(),
      Type.Unknown(),
      Type.Unknown(),
      Type.Unknown(),
      Type.Unknown(),
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

const CompileStatsSchema = Type.Object({
  totalTokens: Type.Number(),
  entriesIncluded: Type.Number(),
  entriesCompressed: Type.Number(),
  compressionRatio: Type.Number(),
  budgetUtilization: Type.Number(),
  elapsedMs: Type.Number(),
});

export const DiariesCompileOutputSchema = Type.Object({
  id: Type.String(),
  diaryId: Type.String(),
  packCid: Type.String(),
  packCodec: Type.String(),
  packType: PackTypeSchema,
  params: Type.Unknown(),
  payload: Type.Unknown(),
  createdBy: Type.String(),
  supersedesPackId: Type.Union([Type.String(), Type.Null()]),
  pinned: Type.Boolean(),
  expiresAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  entries: Type.Array(
    Type.Object({
      id: Type.String(),
      packId: Type.String(),
      entryId: Type.String(),
      entryCidSnapshot: Type.String(),
      compressionLevel: CompressionLevelSchema,
      originalTokens: Type.Union([Type.Number(), Type.Null()]),
      packedTokens: Type.Union([Type.Number(), Type.Null()]),
      rank: Type.Union([Type.Number(), Type.Null()]),
      createdAt: Type.String(),
    }),
  ),
  compileStats: CompileStatsSchema,
  compileTrace: Type.Object({
    lambdaUsed: Type.Number(),
    embeddingDim: Type.Number(),
    taskPromptHash: Type.Optional(Type.String()),
  }),
});

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

type _DiariesListOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof DiariesListOutputSchema>,
  ResponseOf<ListDiariesResponses>
>;
type _DiariesCreateOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof DiariesCreateOutputSchema>,
  ResponseOf<CreateDiaryResponses>
>;
type _DiariesGetOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof DiariesGetOutputSchema>,
  ResponseOf<GetDiaryResponses>
>;
type _DiariesConsolidateOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof DiariesConsolidateOutputSchema>,
  ResponseOf<ConsolidateDiaryResponses>
>;
type _DiariesCompileOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof DiariesCompileOutputSchema>,
  ResponseOf<CompileDiaryResponses>
>;
