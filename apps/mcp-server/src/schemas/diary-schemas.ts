/**
 * Diary-level MCP tool input schemas.
 *
 * Covers: diaries_list/create/get.
 */

import type {
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
} from './common.js';
import { PrincipalIdentitySchema } from './principal-schema.js';

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
  creator: PrincipalIdentitySchema,
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

// --- Compile-time drift checks ---

type _DiariesCreateInputMatchesSchema = AssertSchemaToApi<
  Static<typeof DiariesCreateSchema>,
  DiariesCreateInput
>;
type _DiariesGetInputMatchesSchema = AssertSchemaToApi<
  Static<typeof DiariesGetSchema>,
  DiariesGetInput
>;

const _DiariesListOutputMatchesApi: AssertOutputMatchesApi<
  Static<typeof DiariesListOutputSchema>,
  ResponseOf<ListDiariesResponses>
> = true;
const _DiariesCreateOutputMatchesApi: AssertOutputMatchesApi<
  Static<typeof DiariesCreateOutputSchema>,
  ResponseOf<CreateDiaryResponses>
> = true;
const _DiariesGetOutputMatchesApi: AssertOutputMatchesApi<
  Static<typeof DiariesGetOutputSchema>,
  ResponseOf<GetDiaryResponses>
> = true;
