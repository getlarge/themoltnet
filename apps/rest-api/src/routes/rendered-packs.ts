import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth } from '@moltnet/auth';
import { PackServiceError } from '@moltnet/context-pack-service';
import { DiaryServiceError } from '@moltnet/diary-service';
import { DiaryParamsSchema, ProblemDetailsSchema } from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import {
  PackParamsSchema,
  RenderedPackListSchema,
  RenderedPackParamsSchema,
  RenderedPackPreviewSchema,
  RenderedPackResultSchema,
  RenderedPackUpdateBodySchema,
  RenderedPackWithContentSchema,
  RenderPackBodySchema,
  RenderPackPreviewBodySchema,
} from '../schemas.js';

export async function renderedPackRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

  // POST /packs/:id/render/preview — Preview a rendered pack without persisting
  server.post(
    '/packs/:id/render/preview',
    {
      schema: {
        operationId: 'previewRenderedPack',
        tags: ['diary'],
        description:
          'Preview a rendered pack from a source pack without persisting it.',
        security: [{ bearerAuth: [] }],
        params: PackParamsSchema,
        body: RenderPackPreviewBodySchema,
        response: {
          200: Type.Ref(RenderedPackPreviewSchema),
          400: Type.Ref(ProblemDetailsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const sourcePack = await fastify.contextPackRepository.findById(
        request.params.id,
      );
      if (!sourcePack) {
        throw createProblem('not-found', 'Source pack not found');
      }
      const renderedMarkdown =
        'renderedMarkdown' in request.body
          ? request.body.renderedMarkdown
          : undefined;

      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      try {
        const canRead = await fastify.permissionChecker.canReadPack(
          sourcePack.id,
          identityId,
          subjectNs,
        );
        if (!canRead) {
          throw createProblem('forbidden', 'Not authorized to read this pack');
        }

        const result = await fastify.contextPackService.previewRenderedPack({
          sourcePackId: request.params.id,
          renderedMarkdown,
          renderMethod: request.body.renderMethod,
        });

        return await reply.code(200).send(result);
      } catch (err) {
        if (err instanceof PackServiceError) {
          if (err.code === 'validation') {
            throw createProblem('validation-failed', err.message);
          }
          if (err.code === 'not_found') {
            throw createProblem('not-found', err.message);
          }
        }
        throw err;
      }
    },
  );

  // POST /packs/:id/render — Create rendered pack
  server.post(
    '/packs/:id/render',
    {
      schema: {
        operationId: 'renderContextPack',
        tags: ['diary'],
        description:
          'Render a source pack to structured markdown and persist the result as a new rendered pack with its own CID.',
        security: [{ bearerAuth: [] }],
        params: PackParamsSchema,
        body: RenderPackBodySchema,
        response: {
          201: Type.Ref(RenderedPackResultSchema),
          400: Type.Ref(ProblemDetailsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          409: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const sourcePack = await fastify.contextPackRepository.findById(
        request.params.id,
      );
      if (!sourcePack) {
        throw createProblem('not-found', 'Source pack not found');
      }
      const renderedMarkdown =
        'renderedMarkdown' in request.body
          ? request.body.renderedMarkdown
          : undefined;

      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      try {
        const canManage = await fastify.permissionChecker.canManagePack(
          sourcePack.id,
          identityId,
          subjectNs,
        );
        if (!canManage) {
          throw createProblem(
            'forbidden',
            'Not authorized to manage this pack',
          );
        }

        const result = await fastify.contextPackService.createRenderedPack({
          sourcePackId: request.params.id,
          renderedMarkdown,
          renderMethod: request.body.renderMethod,
          createdBy: identityId,
          pinned: request.body.pinned,
        });

        if (result.renderMethod.startsWith('server:')) {
          await fastify.attestationRepository.create({
            renderedPackId: result.id,
            coverage: 1.0,
            grounding: 1.0,
            faithfulness: 1.0,
            composite: 1.0,
            judgeModel: 'deterministic',
            judgeProvider: 'server',
            judgeBinaryCid: 'server:deterministic',
            rubricCid: null,
            createdBy: identityId,
            transcript:
              'Server-side deterministic rendering. Fidelity guaranteed by construction.',
          });
        }

        return await reply.code(201).send(result);
      } catch (err) {
        if (err instanceof PackServiceError) {
          if (err.code === 'validation') {
            throw createProblem('validation-failed', err.message);
          }
          if (err.code === 'not_found') {
            throw createProblem('not-found', err.message);
          }
          if (err.code === 'conflict') {
            throw createProblem('conflict', err.message);
          }
        }
        throw err;
      }
    },
  );

  // GET /packs/:id/rendered — Get latest rendered pack for a source pack
  server.get(
    '/packs/:id/rendered',
    {
      schema: {
        operationId: 'getLatestRenderedPack',
        tags: ['diary'],
        description: 'Get the latest rendered pack for a source context pack.',
        security: [{ bearerAuth: [] }],
        params: PackParamsSchema,
        response: {
          200: Type.Ref(RenderedPackWithContentSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const sourcePack = await fastify.contextPackRepository.findById(
        request.params.id,
      );
      if (!sourcePack) {
        throw createProblem('not-found', 'Source pack not found');
      }

      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      const allowed = await fastify.permissionChecker.canReadPack(
        sourcePack.id,
        identityId,
        subjectNs,
      );
      if (!allowed) {
        throw createProblem('forbidden', 'Not authorized to read this pack');
      }

      const rendered =
        await fastify.renderedPackRepository.findLatestBySourcePackId(
          sourcePack.id,
        );
      if (!rendered) {
        throw createProblem(
          'not-found',
          'No rendered pack found for this source pack',
        );
      }

      return rendered;
    },
  );

  // GET /diaries/:id/rendered-packs — List rendered packs for a diary
  const RenderedPackListQuerySchema = Type.Object({
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    sourcePackId: Type.Optional(
      Type.String({ format: 'uuid', description: 'Filter by source pack ID' }),
    ),
    renderMethod: Type.Optional(
      Type.String({ description: 'Filter by render method label' }),
    ),
  });

  server.get(
    '/diaries/:id/rendered-packs',
    {
      schema: {
        operationId: 'listDiaryRenderedPacks',
        tags: ['diary'],
        description:
          'List rendered packs for a diary. Optionally filter by source pack ID or render method.',
        security: [{ bearerAuth: [] }],
        params: DiaryParamsSchema,
        querystring: RenderedPackListQuerySchema,
        response: {
          200: Type.Ref(RenderedPackListSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      let diary: Awaited<ReturnType<typeof fastify.diaryService.findDiary>>;
      try {
        diary = await fastify.diaryService.findDiary(
          request.params.id,
          identityId,
          subjectNs,
        );
      } catch (err) {
        if (err instanceof DiaryServiceError) {
          switch (err.code) {
            case 'not_found':
              throw createProblem('not-found', err.message);
            case 'forbidden':
              throw createProblem('forbidden', err.message);
            default:
              throw createProblem('internal', err.message);
          }
        }
        throw err;
      }

      const limit = request.query.limit ?? 20;
      const offset = request.query.offset ?? 0;
      const { items, total } = await fastify.renderedPackRepository.listByDiary(
        diary.id,
        limit,
        offset,
        {
          sourcePackId: request.query.sourcePackId,
          renderMethod: request.query.renderMethod,
        },
      );

      // Batch-check read permission via each rendered pack's source pack.
      const sourcePackIds = [...new Set(items.map((rp) => rp.sourcePackId))];
      let allowedSourcePacks: Map<string, boolean>;
      try {
        allowedSourcePacks = await fastify.permissionChecker.canReadPacks(
          sourcePackIds,
          identityId,
          subjectNs,
        );
      } catch (error) {
        request.log.error(
          { err: error, diaryId: diary.id },
          'Failed to batch-check rendered pack permissions',
        );
        throw createProblem('internal', 'Failed to verify pack permissions');
      }

      const visibleItems = items.filter(
        (rp) => allowedSourcePacks.get(rp.sourcePackId) ?? false,
      );
      const deniedOnPage = items.length - visibleItems.length;
      const adjustedTotal = total - deniedOnPage;

      return { items: visibleItems, total: adjustedTotal, limit, offset };
    },
  );

  // GET /rendered-packs/:id — Get rendered pack by ID
  server.get(
    '/rendered-packs/:id',
    {
      schema: {
        operationId: 'getRenderedPackById',
        tags: ['diary'],
        description: 'Get a rendered pack by its ID.',
        security: [{ bearerAuth: [] }],
        params: RenderedPackParamsSchema,
        response: {
          200: Type.Ref(RenderedPackWithContentSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const rendered = await fastify.renderedPackRepository.findById(
        request.params.id,
      );
      if (!rendered) {
        throw createProblem('not-found', 'Rendered pack not found');
      }

      // Permission check via source pack
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      const allowed = await fastify.permissionChecker.canReadPack(
        rendered.sourcePackId,
        identityId,
        subjectNs,
      );
      if (!allowed) {
        throw createProblem(
          'forbidden',
          'Not authorized to read this rendered pack',
        );
      }

      return rendered;
    },
  );

  // ── PATCH /rendered-packs/:id ──────────────────────────────────

  server.patch(
    '/rendered-packs/:id',
    {
      schema: {
        operationId: 'updateRenderedPack',
        tags: ['diary'],
        description:
          'Update a rendered pack — pin/unpin or change expiration. Only the diary owner can manage packs.',
        security: [{ bearerAuth: [] }],
        params: RenderedPackParamsSchema,
        body: RenderedPackUpdateBodySchema,
        response: {
          200: Type.Ref(RenderedPackWithContentSchema),
          400: Type.Ref(ProblemDetailsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          409: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const rendered = await fastify.renderedPackRepository.findById(
        request.params.id,
      );
      if (!rendered) {
        throw createProblem('not-found', 'Rendered pack not found');
      }

      // Permission check via source pack
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      const allowed = await fastify.permissionChecker.canManagePack(
        rendered.sourcePackId,
        identityId,
        subjectNs,
      );
      if (!allowed) {
        throw createProblem(
          'forbidden',
          'Not authorized to manage this rendered pack',
        );
      }

      const { pinned, expiresAt } = request.body;
      const now = new Date();

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
      if (pinned === undefined && expiresAt !== undefined && rendered.pinned) {
        throw createProblem(
          'validation-failed',
          'Cannot set expiresAt on a pinned pack — unpin it first or send pinned: false together',
        );
      }
      // Schema-level `minProperties: 1` guarantees at least one field is set.

      const updated = await fastify.dataSource.runTransaction(async () => {
        if (pinned === true) {
          return fastify.renderedPackRepository.pin(rendered.id);
        } else if (pinned === false) {
          return fastify.renderedPackRepository.unpin(
            rendered.id,
            new Date(expiresAt!),
          );
        } else {
          // updateExpiry filters on `pinned = false`. A concurrent pin between
          // the pre-check and this write produces a silent no-op — surface it
          // as a conflict rather than returning stale state.
          const result = await fastify.renderedPackRepository.updateExpiry(
            rendered.id,
            new Date(expiresAt!),
          );
          if (!result) {
            throw createProblem(
              'conflict',
              'Rendered pack state changed concurrently — retry the request',
            );
          }
          return result;
        }
      });

      if (!updated) {
        throw createProblem(
          'not-found',
          'Rendered pack not found after update',
        );
      }
      return updated;
    },
  );
}
