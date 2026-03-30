import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import {
  type EntryFetcher,
  EntryLoadError,
  fitEntries,
  loadSelectedEntries,
  PackServiceError,
} from '@moltnet/context-pack-service';
import { computePackCid } from '@moltnet/crypto-service';
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
  CustomPackBodySchema,
  CustomPackResultSchema,
  PackCidParamsSchema,
  PackListQuerySchema,
  PackParamsSchema,
  PackProvenanceQuerySchema,
  PackQuerySchema,
  PackUpdateBodySchema,
} from '../schemas.js';
import { buildPackProvenanceGraph } from './pack-provenance.js';

function wantsExpandedEntries(expand?: 'entries'): boolean {
  return expand === 'entries';
}

function toListResponse<T>(
  items: T[],
  total: number,
  limit: number,
  offset: number,
) {
  return { items, total, limit, offset };
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

function translateServiceError(err: unknown): never {
  if (err instanceof EntryLoadError) {
    throw createProblem('validation-failed', err.message);
  }
  if (err instanceof PackServiceError) {
    switch (err.code) {
      case 'not_found':
        throw createProblem('not-found', err.message);
      case 'conflict':
        throw createProblem('conflict', err.message);
      case 'validation':
        throw createProblem('validation-failed', err.message);
      default:
        throw createProblem('internal', err.message);
    }
  }
  throw err;
}

/** Build an EntryFetcher that delegates to the diary entry repository. */
function makeEntryFetcher(fastify: FastifyInstance): EntryFetcher {
  return {
    fetchEntries: async (diaryId: string, ids: string[]) => {
      const { items } = await fastify.diaryEntryRepository.list({
        diaryId,
        ids,
        limit: ids.length,
      });
      return items;
    },
  };
}

export async function packRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

  const entryFetcher = makeEntryFetcher(fastify);

  /**
   * Preview a custom pack: load entries, fit to budget, compute CID.
   * No persistence, no Keto grants.
   */
  const previewCustomPack = async (
    diaryId: string,
    body: {
      params: Record<string, unknown>;
      entries: Array<{ entryId: string; rank: number }>;
      tokenBudget?: number;
    },
  ) => {
    const selectedEntries = await loadSelectedEntries(
      entryFetcher,
      diaryId,
      body.entries,
    );
    const fitResult = fitEntries(selectedEntries, body.tokenBudget);

    const packCid = computePackCid({
      diaryId,
      packType: 'custom',
      params: body.params,
      entries: fitResult.entries.map((e) => ({
        cid: e.entryCidSnapshot,
        compressionLevel: e.compressionLevel,
        rank: e.rank,
      })),
    });

    return {
      packCid,
      packType: 'custom' as const,
      params: body.params,
      entries: fitResult.entries,
      compileStats: fitResult.stats,
    };
  };

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

  server.post(
    '/diaries/:id/packs/preview',
    {
      schema: {
        operationId: 'previewDiaryCustomPack',
        tags: ['diary'],
        description:
          'Preview a custom context pack from an explicit entry selection without persisting it.',
        security: [{ bearerAuth: [] }],
        params: DiaryParamsSchema,
        body: CustomPackBodySchema,
        response: {
          200: Type.Ref(CustomPackResultSchema),
          400: Type.Ref(ProblemDetailsSchema),
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

      try {
        return await previewCustomPack(diary.id, request.body);
      } catch (err) {
        translateServiceError(err);
      }
    },
  );

  server.post(
    '/diaries/:id/packs',
    {
      schema: {
        operationId: 'createDiaryCustomPack',
        tags: ['diary'],
        description:
          'Create and persist a custom context pack from an explicit entry selection.',
        security: [{ bearerAuth: [] }],
        params: DiaryParamsSchema,
        body: CustomPackBodySchema,
        response: {
          201: Type.Ref(CustomPackResultSchema),
          400: Type.Ref(ProblemDetailsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
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

      try {
        const result = await fastify.contextPackService.createCustomPack({
          diaryId: diary.id,
          entries: request.body.entries,
          params: request.body.params,
          tokenBudget: request.body.tokenBudget,
          pinned: request.body.pinned,
          createdBy: request.authContext!.identityId,
        });

        return await reply.code(201).send({
          packCid: result.packCid,
          packType: result.packType,
          params: request.body.params,
          entries: result.fitResult.entries,
          compileStats: result.fitResult.stats,
        });
      } catch (err) {
        translateServiceError(err);
      }
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
      const offset = request.query.offset ?? 0;
      const { items: packs, total } =
        await fastify.contextPackRepository.listByDiary(
          diary.id,
          limit,
          offset,
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
      // Adjust total to account for permission-filtered packs on this page.
      // Packs on other pages may also be denied, so this is a best-effort
      // lower bound — but far more useful than the raw DB count.
      const deniedOnPage = packs.length - visiblePacks.length;
      const adjustedTotal = total - deniedOnPage;

      if (!wantsExpandedEntries(request.query.expand)) {
        return toListResponse(visiblePacks, adjustedTotal, limit, offset);
      }

      const entriesByPack =
        await fastify.contextPackRepository.listEntriesExpandedByPackIds(
          visiblePacks.map((pack) => pack.id),
        );

      const items = visiblePacks.map((pack) => ({
        ...pack,
        entries: entriesByPack.get(pack.id) ?? [],
      }));

      return toListResponse(items, adjustedTotal, limit, offset);
    },
  );

  // ── PATCH /packs/:id ──────────────────────────────────────────

  server.patch(
    '/packs/:id',
    {
      schema: {
        operationId: 'updateContextPack',
        tags: ['diary'],
        description:
          'Update a context pack — pin/unpin or change expiration. Only the diary owner can manage packs.',
        security: [{ bearerAuth: [] }],
        params: PackParamsSchema,
        body: PackUpdateBodySchema,
        response: {
          200: Type.Ref(ContextPackResponseSchema),
          400: Type.Ref(ProblemDetailsSchema),
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

      const allowed = await fastify.permissionChecker.canManagePack(
        pack.id,
        request.authContext!.identityId,
      );
      if (!allowed) {
        throw createProblem('forbidden', 'Not authorized to manage this pack');
      }

      const { pinned, expiresAt } = request.body;
      const now = new Date();

      // Validate upfront before entering the transaction
      if (pinned === false && !expiresAt) {
        throw createProblem(
          'validation-failed',
          'expiresAt is required when setting pinned to false',
        );
      }
      if (
        expiresAt !== undefined &&
        pinned !== true &&
        new Date(expiresAt) <= now
      ) {
        throw createProblem(
          'validation-failed',
          'expiresAt must be in the future',
        );
      }
      if (pinned === undefined && expiresAt !== undefined && pack.pinned) {
        throw createProblem(
          'validation-failed',
          'Cannot set expiresAt on a pinned pack — unpin it first or send pinned: false together',
        );
      }
      if (pinned === undefined && expiresAt === undefined) {
        throw createProblem(
          'validation-failed',
          'At least one of pinned or expiresAt must be provided',
        );
      }

      // Mutate + re-fetch atomically to avoid race with GC
      const updated = await fastify.dataSource.runTransaction(async () => {
        if (pinned === true) {
          await fastify.contextPackRepository.pin(pack.id);
        } else if (pinned === false) {
          await fastify.contextPackRepository.unpin(
            pack.id,
            new Date(expiresAt!),
          );
        } else if (expiresAt !== undefined) {
          await fastify.contextPackRepository.updateExpiry(
            pack.id,
            new Date(expiresAt),
          );
        }

        return fastify.contextPackRepository.findById(pack.id);
      });

      if (!updated) {
        throw createProblem('not-found', 'Context pack not found');
      }
      return updated;
    },
  );
}
