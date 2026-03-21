import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import { DiaryServiceError } from '@moltnet/diary-service';
import {
  DiaryParamsSchema,
  ProblemDetailsSchema,
  ProvenanceGraphSchema,
} from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import {
  ContextPackResponseListSchema,
  ContextPackResponseSchema,
} from '../schemas.js';
import { buildPackProvenanceGraph } from './pack-provenance.js';

const PackParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

const PackQuerySchema = Type.Object({
  expand: Type.Optional(Type.Literal('entries')),
});

const PackListQuerySchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  expand: Type.Optional(Type.Literal('entries')),
});

const PackCidParamsSchema = Type.Object({
  cid: Type.String(),
});

const PackProvenanceQuerySchema = Type.Object({
  depth: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
});

function wantsExpandedEntries(expand?: 'entries'): boolean {
  return expand === 'entries';
}

function toListResponse<T>(items: T[], limit: number) {
  return {
    items,
    // `total` follows the existing REST list convention in this API:
    // it reports the number of items returned in this response window.
    total: items.length,
    limit,
  };
}

function translateFindDiaryError(err: DiaryServiceError): never {
  switch (err.code) {
    case 'not_found':
      throw createProblem('not-found', err.message);
    case 'forbidden':
      throw createProblem('forbidden', err.message);
    default:
      throw createProblem('internal', err.message);
  }
}

export async function packRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

  server.get(
    '/packs/:id/provenance',
    {
      schema: {
        operationId: 'getContextPackProvenanceById',
        tags: ['diary'],
        description:
          'Export the provenance graph for a persisted context pack by ID.',
        security: [{ bearerAuth: [] }],
        params: PackParamsSchema,
        querystring: PackProvenanceQuerySchema,
        response: {
          200: Type.Ref(ProvenanceGraphSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const pack = await fastify.contextPackRepository.findById(
        request.params.id,
      );
      if (!pack) {
        throw createProblem('not-found', 'Context pack not found');
      }

      const allowed = await fastify.permissionChecker.canReadPack(
        pack.id,
        request.authContext!.identityId,
      );
      if (!allowed) {
        throw createProblem('forbidden', 'Not authorized to read this pack');
      }

      try {
        return await buildPackProvenanceGraph({
          fastify,
          rootPack: pack,
          depth: request.query.depth ?? 2,
          identityId: request.authContext!.identityId,
        });
      } catch (error) {
        request.log.error(
          { err: error, packId: pack.id },
          'Failed to build pack provenance graph',
        );
        throw createProblem('internal', 'Failed to build pack provenance');
      }
    },
  );

  server.get(
    '/packs/by-cid/:cid/provenance',
    {
      schema: {
        operationId: 'getContextPackProvenanceByCid',
        tags: ['diary'],
        description:
          'Export the provenance graph for a persisted context pack by CID.',
        security: [{ bearerAuth: [] }],
        params: PackCidParamsSchema,
        querystring: PackProvenanceQuerySchema,
        response: {
          200: ProvenanceGraphSchema,
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const pack = await fastify.contextPackRepository.findByCid(
        request.params.cid,
      );
      if (!pack) {
        throw createProblem('not-found', 'Context pack not found');
      }

      const allowed = await fastify.permissionChecker.canReadPack(
        pack.id,
        request.authContext!.identityId,
      );
      if (!allowed) {
        throw createProblem('forbidden', 'Not authorized to read this pack');
      }

      try {
        return await buildPackProvenanceGraph({
          fastify,
          rootPack: pack,
          depth: request.query.depth ?? 2,
          identityId: request.authContext!.identityId,
        });
      } catch (error) {
        request.log.error(
          { err: error, packCid: request.params.cid, packId: pack.id },
          'Failed to build pack provenance graph',
        );
        throw createProblem('internal', 'Failed to build pack provenance');
      }
    },
  );

  server.get(
    '/packs/:id',
    {
      schema: {
        operationId: 'getContextPackById',
        tags: ['diary'],
        description:
          'Get a persisted context pack by ID. Use `expand=entries` to include entry content.',
        security: [{ bearerAuth: [] }],
        params: PackParamsSchema,
        querystring: PackQuerySchema,
        response: {
          200: Type.Ref(ContextPackResponseSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const pack = await fastify.contextPackRepository.findById(
        request.params.id,
      );
      if (!pack) {
        throw createProblem('not-found', 'Context pack not found');
      }

      const allowed = await fastify.permissionChecker.canReadPack(
        pack.id,
        request.authContext!.identityId,
      );
      if (!allowed) {
        throw createProblem('forbidden', 'Not authorized to read this pack');
      }

      if (!wantsExpandedEntries(request.query.expand)) {
        return pack;
      }

      return {
        ...pack,
        entries: await fastify.contextPackRepository.listEntriesExpanded(
          pack.id,
        ),
      };
    },
  );

  server.get(
    '/diaries/:id/packs',
    {
      schema: {
        operationId: 'listDiaryPacks',
        tags: ['diary'],
        description:
          'List persisted context packs for a diary. Use `expand=entries` to include entry content.',
        security: [{ bearerAuth: [] }],
        params: DiaryParamsSchema,
        querystring: PackListQuerySchema,
        response: {
          200: Type.Ref(ContextPackResponseListSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      let diary: Awaited<ReturnType<typeof fastify.diaryService.findDiary>>;
      try {
        diary = await fastify.diaryService.findDiary(
          request.params.id,
          request.authContext!.identityId,
        );
      } catch (err) {
        if (err instanceof DiaryServiceError) translateFindDiaryError(err);
        throw err;
      }
      const limit = request.query.limit ?? 20;
      const packs = await fastify.contextPackRepository.listByDiary(
        diary.id,
        limit,
      );
      let allowedPackIds: Map<string, boolean>;
      try {
        allowedPackIds = await fastify.permissionChecker.canReadPacks(
          packs.map((pack) => pack.id),
          request.authContext!.identityId,
        );
      } catch (error) {
        request.log.error(
          { err: error, diaryId: diary.id },
          'Failed to batch-check pack permissions',
        );
        throw createProblem('internal', 'Failed to verify pack permissions');
      }
      const visiblePacks = packs.filter(
        (pack) => allowedPackIds.get(pack.id) ?? false,
      );

      if (!wantsExpandedEntries(request.query.expand)) {
        return toListResponse(visiblePacks, limit);
      }

      const entriesByPack =
        await fastify.contextPackRepository.listEntriesExpandedByPackIds(
          visiblePacks.map((pack) => pack.id),
        );

      const items = visiblePacks.map((pack) => ({
        ...pack,
        entries: entriesByPack.get(pack.id) ?? [],
      }));

      return toListResponse(items, limit);
    },
  );
}
