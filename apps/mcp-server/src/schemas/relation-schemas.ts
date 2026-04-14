/**
 * Entry relation MCP tool input schemas.
 *
 * Covers: relations_create/list/update/delete.
 */

import type {
  CreateEntryRelationData,
  DeleteEntryRelationData,
  ListEntryRelationsData,
  UpdateEntryRelationStatusData,
} from '@moltnet/api-client';
import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

import type { AssertSchemaToApi, BodyOf, PathOf } from './common.js';

export const RelationCreateSchema = Type.Object({
  entry_id: Type.String({
    description: 'Source entry ID (UUID).',
  }),
  target_id: Type.String({
    description: 'Target entry ID (UUID).',
  }),
  relation: Type.Union(
    [
      Type.Literal('supersedes'),
      Type.Literal('elaborates'),
      Type.Literal('contradicts'),
      Type.Literal('supports'),
      Type.Literal('caused_by'),
      Type.Literal('references'),
    ],
    { description: 'Relation type.' },
  ),
  status: Type.Optional(
    Type.Union([Type.Literal('proposed'), Type.Literal('accepted')], {
      description: 'Initial status. Default proposed.',
    }),
  ),
});
type CreateRelationBody = BodyOf<CreateEntryRelationData>;
export type RelationCreateInput = {
  entry_id: PathOf<CreateEntryRelationData>['entryId'];
  target_id: CreateRelationBody['targetId'];
  relation: CreateRelationBody['relation'];
  status?: CreateRelationBody['status'];
};

export const RelationListSchema = Type.Object({
  entry_id: Type.String({
    description: 'Entry ID (UUID) to list relations for.',
  }),
  relation: Type.Optional(
    Type.Union(
      [
        Type.Literal('supersedes'),
        Type.Literal('elaborates'),
        Type.Literal('contradicts'),
        Type.Literal('supports'),
        Type.Literal('caused_by'),
        Type.Literal('references'),
      ],
      { description: 'Filter by relation type.' },
    ),
  ),
  status: Type.Optional(
    Type.Union(
      [
        Type.Literal('proposed'),
        Type.Literal('accepted'),
        Type.Literal('rejected'),
      ],
      { description: 'Filter by status.' },
    ),
  ),
  direction: Type.Optional(
    Type.Union(
      [
        Type.Literal('as_source'),
        Type.Literal('as_target'),
        Type.Literal('both'),
      ],
      { description: 'Direction filter. Default both.' },
    ),
  ),
  limit: Type.Optional(
    Type.Number({ description: 'Max results (default 20)' }),
  ),
});
type ListRelationsQuery = NonNullable<ListEntryRelationsData['query']>;
export type RelationListInput = {
  entry_id: PathOf<ListEntryRelationsData>['entryId'];
  relation?: ListRelationsQuery['relation'];
  status?: ListRelationsQuery['status'];
  direction?: ListRelationsQuery['direction'];
  limit?: ListRelationsQuery['limit'];
};

export const RelationUpdateSchema = Type.Object({
  relation_id: Type.String({
    description: 'Relation ID to update.',
  }),
  status: Type.Union(
    [
      Type.Literal('proposed'),
      Type.Literal('accepted'),
      Type.Literal('rejected'),
    ],
    { description: 'New status for the relation.' },
  ),
});
type UpdateRelationBody = BodyOf<UpdateEntryRelationStatusData>;
export type RelationUpdateInput = {
  relation_id: PathOf<UpdateEntryRelationStatusData>['id'];
  status: UpdateRelationBody['status'];
};

export const RelationDeleteSchema = Type.Object({
  relation_id: Type.String({
    description: 'Relation ID to delete.',
  }),
});
export type RelationDeleteInput = {
  relation_id: PathOf<DeleteEntryRelationData>['id'];
};

// --- Compile-time drift checks ---

type _RelationCreateInputMatchesSchema = AssertSchemaToApi<
  Static<typeof RelationCreateSchema>,
  RelationCreateInput
>;
type _RelationListInputMatchesSchema = AssertSchemaToApi<
  Static<typeof RelationListSchema>,
  RelationListInput
>;
type _RelationUpdateInputMatchesSchema = AssertSchemaToApi<
  Static<typeof RelationUpdateSchema>,
  RelationUpdateInput
>;
type _RelationDeleteInputMatchesSchema = AssertSchemaToApi<
  Static<typeof RelationDeleteSchema>,
  RelationDeleteInput
>;
