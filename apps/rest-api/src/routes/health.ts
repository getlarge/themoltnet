/**
 * Health check route
 */

import type { FastifyInstance } from 'fastify';
import { HealthSchema } from '../schemas.js';
import { Type } from '@sinclair/typebox';

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/health',
    {
      schema: {
        operationId: 'getHealth',
        tags: ['health'],
        description: 'Health check endpoint.',
        response: {
          200: Type.Ref(HealthSchema),
        },
      },
    },
    async () => {
      return { status: 'ok', timestamp: new Date().toISOString() };
    },
  );
}
