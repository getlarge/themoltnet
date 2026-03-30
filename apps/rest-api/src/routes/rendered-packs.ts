import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth } from '@moltnet/auth';
import { PackServiceError } from '@moltnet/context-pack-service';
import { ProblemDetailsSchema } from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import {
  PackParamsSchema,
  RenderedPackParamsSchema,
  RenderedPackPreviewSchema,
  RenderedPackResultSchema,
  RenderedPackWithContentSchema,
  RenderPackBodySchema,
} from '../schemas.js';

export async function renderedPackRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

  // POST /packs/:id/render — Create rendered pack (or preview)
  server.post(
    '/packs/:id/render',
    {
      schema: {
        operationId: 'renderContextPack',
        tags: ['diary'],
        description:
          'Render a source pack to structured markdown. By default persists ' +
          'the result as a new rendered pack with its own CID. Pass ' +
          '`preview: true` to return the rendered markdown without persisting.',
        security: [{ bearerAuth: [] }],
        params: PackParamsSchema,
        body: RenderPackBodySchema,
        response: {
          200: Type.Ref(RenderedPackPreviewSchema),
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
        if (request.body.preview) {
          const canRead = await fastify.permissionChecker.canReadPack(
            sourcePack.id,
            identityId,
            subjectNs,
          );
          if (!canRead) {
            throw createProblem(
              'forbidden',
              'Not authorized to read this pack',
            );
          }

          const result = await fastify.contextPackService.previewRenderedPack({
            sourcePackId: request.params.id,
            renderedMarkdown,
            renderMethod: request.body.renderMethod,
          });

          return await reply.code(200).send(result);
        }

        // Persistence requires manage permission
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
}
