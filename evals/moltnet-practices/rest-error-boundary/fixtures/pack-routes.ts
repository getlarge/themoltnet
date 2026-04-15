import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';

export async function packRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();

  server.addHook('preHandler', requireAuth);

  server.get(
    '/packs/:id',
    {
      schema: {
        operationId: 'getPack',
        tags: ['packs'],
        params: Type.Object({
          id: Type.String({ description: 'Pack ID (UUID).' }),
        }),
      },
    },
    async (request) => {
      const { id } = request.params;
      const pack = await fastify.packService.getById(id);
      if (!pack) {
        throw createProblem('not-found', `Pack ${id} not found`);
      }
      const agentId = request.authContext!.identityId;
      if (pack.diaryOwnerId !== agentId) {
        throw createProblem('forbidden', 'Not authorized to access this pack');
      }
      return pack;
    },
  );

  server.delete(
    '/packs/:id',
    {
      schema: {
        operationId: 'deletePack',
        tags: ['packs'],
        params: Type.Object({
          id: Type.String({ description: 'Pack ID (UUID).' }),
        }),
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const pack = await fastify.packService.getById(id);
      if (!pack) {
        throw createProblem('not-found', `Pack ${id} not found`);
      }
      if (pack.pinned) {
        throw createProblem('conflict', 'Cannot delete a pinned pack');
      }
      await fastify.packService.delete(id);
      return reply.status(204).send();
    },
  );
}
