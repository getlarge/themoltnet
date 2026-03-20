/**
 * Entry relation CRUD routes
 *
 * POST /entries/:entryId/relations   — create a relation
 * GET  /entries/:entryId/relations   — list relations for an entry
 * PATCH /relations/:id               — update relation status
 * DELETE /relations/:id              — delete a relation
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import type { EntryRelation } from '@moltnet/database';
import { EntryParamsSchema, ProblemDetailsSchema } from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import {
  EntryRelationListSchema,
  EntryRelationSchema,
  RelationStatusSchema,
  RelationTypeSchema,
} from '../schemas.js';

/**
 * Map a DB EntryRelation row to the API response shape.
 * The DB stores confidence/similarity inside the `metadata` jsonb column;
 * the REST schema exposes them as top-level nullable numbers.
 */
function toRelationResponse(row: EntryRelation) {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    sourceId: row.sourceId,
    targetId: row.targetId,
    relation: row.relation,
    status: row.status,
    sourceCidSnapshot: row.sourceCidSnapshot ?? null,
    targetCidSnapshot: row.targetCidSnapshot ?? null,
    workflowId: row.workflowId ?? null,
    confidence: typeof meta.confidence === 'number' ? meta.confidence : null,
    similarity: typeof meta.similarity === 'number' ? meta.similarity : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as const;
}

const RelationIdParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

const CreateRelationBodySchema = Type.Object({
  targetId: Type.String({ format: 'uuid' }),
  relation: Type.Ref(RelationTypeSchema),
  status: Type.Optional(
    Type.Union([Type.Literal('proposed'), Type.Literal('accepted')]),
  ),
});

const ListRelationsQuerySchema = Type.Object({
  relation: Type.Optional(Type.Ref(RelationTypeSchema)),
  status: Type.Optional(Type.Ref(RelationStatusSchema)),
  direction: Type.Optional(
    Type.Union([
      Type.Literal('as_source'),
      Type.Literal('as_target'),
      Type.Literal('both'),
    ]),
  ),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});

const UpdateRelationStatusBodySchema = Type.Object({
  status: Type.Ref(RelationStatusSchema),
});

export async function entryRelationRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

  // ── POST /entries/:entryId/relations ──────────────────────
  server.post(
    '/entries/:entryId/relations',
    {
      schema: {
        operationId: 'createEntryRelation',
        tags: ['diary'],
        description:
          'Create a relation between two diary entries. Idempotent on (sourceId, targetId, relation) — returns 200 if the relation already exists.',
        security: [{ bearerAuth: [] }],
        params: EntryParamsSchema,
        body: CreateRelationBodySchema,
        response: {
          201: Type.Ref(EntryRelationSchema),
          200: Type.Ref(EntryRelationSchema),
          400: Type.Ref(ProblemDetailsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const identityId = request.authContext!.identityId;
      const { entryId } = request.params;
      const { targetId, relation, status = 'proposed' } = request.body;

      const allowed = await fastify.permissionChecker.canEditEntry(
        entryId,
        identityId,
      );
      if (!allowed) {
        throw createProblem('forbidden', 'Not authorized to edit this entry');
      }

      // Validate both entries exist and belong to the same diary
      const entries = await fastify.diaryEntryRepository.findByIds([
        entryId,
        targetId,
      ]);
      if (entries.length < 2) {
        throw createProblem('not-found', 'One or both entries not found');
      }

      const [source, target] = [
        entries.find((e) => e.id === entryId),
        entries.find((e) => e.id === targetId),
      ];

      if (!source || !target) {
        throw createProblem('not-found', 'One or both entries not found');
      }

      if (source.diaryId !== target.diaryId) {
        throw createProblem(
          'validation-failed',
          'Both entries must belong to the same diary',
        );
      }

      const timestampBefore = new Date();

      const created = await fastify.entryRelationRepository.create({
        sourceId: entryId,
        targetId,
        relation,
        status,
      });

      const isNew =
        created.createdAt >= timestampBefore ||
        created.createdAt.getTime() >= timestampBefore.getTime();

      reply.status(isNew ? 201 : 200);
      return toRelationResponse(created);
    },
  );

  // ── GET /entries/:entryId/relations ───────────────────────
  server.get(
    '/entries/:entryId/relations',
    {
      schema: {
        operationId: 'listEntryRelations',
        tags: ['diary'],
        description: 'List relations for a diary entry.',
        security: [{ bearerAuth: [] }],
        params: EntryParamsSchema,
        querystring: ListRelationsQuerySchema,
        response: {
          200: Type.Ref(EntryRelationListSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const identityId = request.authContext!.identityId;
      const { entryId } = request.params;
      const { relation, status, direction, limit = 50 } = request.query;

      const allowed = await fastify.permissionChecker.canViewEntry(
        entryId,
        identityId,
      );
      if (!allowed) {
        throw createProblem('forbidden', 'Not authorized to view this entry');
      }

      const items = await fastify.entryRelationRepository.listByEntry(entryId, {
        relation,
        status,
        direction,
        limit,
      });

      return {
        items: items.map(toRelationResponse),
        total: items.length,
        limit,
      };
    },
  );

  // ── PATCH /relations/:id ──────────────────────────────────
  server.patch(
    '/relations/:id',
    {
      schema: {
        operationId: 'updateEntryRelationStatus',
        tags: ['diary'],
        description: 'Update the status of an entry relation.',
        security: [{ bearerAuth: [] }],
        params: RelationIdParamsSchema,
        body: UpdateRelationStatusBodySchema,
        response: {
          200: Type.Ref(EntryRelationSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const identityId = request.authContext!.identityId;
      const { id } = request.params;
      const { status } = request.body;

      const relation = await fastify.entryRelationRepository.findById(id);
      if (!relation) {
        throw createProblem('not-found', 'Entry relation not found');
      }

      const allowed = await fastify.permissionChecker.canEditAnyEntry(
        [relation.sourceId, relation.targetId],
        identityId,
      );
      if (!allowed) {
        throw createProblem(
          'forbidden',
          'Not authorized to edit this relation',
        );
      }

      const updated = await fastify.entryRelationRepository.updateStatus(
        id,
        status,
      );
      if (!updated) {
        throw createProblem('not-found', 'Entry relation not found');
      }

      return toRelationResponse(updated);
    },
  );

  // ── DELETE /relations/:id ─────────────────────────────────
  server.delete(
    '/relations/:id',
    {
      schema: {
        operationId: 'deleteEntryRelation',
        tags: ['diary'],
        description: 'Delete an entry relation.',
        security: [{ bearerAuth: [] }],
        params: RelationIdParamsSchema,
        response: {
          204: Type.Null(),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const identityId = request.authContext!.identityId;
      const { id } = request.params;

      const relation = await fastify.entryRelationRepository.findById(id);
      if (!relation) {
        throw createProblem('not-found', 'Entry relation not found');
      }

      const allowed = await fastify.permissionChecker.canEditAnyEntry(
        [relation.sourceId, relation.targetId],
        identityId,
      );
      if (!allowed) {
        throw createProblem(
          'forbidden',
          'Not authorized to delete this relation',
        );
      }

      await fastify.entryRelationRepository.delete(id);
      reply.status(204);
    },
  );
}
