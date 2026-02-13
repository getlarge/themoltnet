/**
 * Problem type documentation routes (RFC 9457)
 *
 * Public endpoints that document all problem types used in API error responses.
 * No authentication required — these serve as machine-readable error docs.
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import {
  getTypeUri,
  type ProblemType,
  problemTypes,
} from '../problems/registry.js';

function toResponseEntry(pt: ProblemType) {
  return {
    type: getTypeUri(pt.slug),
    title: pt.title,
    status: pt.status,
    code: pt.code,
    description: pt.description,
    commonCauses: pt.commonCauses,
  };
}

export async function problemRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();

  server.get(
    '/problems',
    {
      schema: {
        operationId: 'listProblemTypes',
        tags: ['problems'],
        description:
          'List all problem types used in API error responses (RFC 9457).',
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', format: 'uri' },
                title: { type: 'string' },
                status: { type: 'integer' },
                code: { type: 'string' },
                description: { type: 'string' },
                commonCauses: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      return Object.values(problemTypes).map(toResponseEntry);
    },
  );

  server.get(
    '/problems/:type',
    {
      schema: {
        operationId: 'getProblemType',
        tags: ['problems'],
        description: 'Get details about a specific problem type (RFC 9457).',
        params: Type.Object({
          type: Type.String(),
        }),
      },
    },
    async (request, reply) => {
      const { type } = request.params;
      const problemType = problemTypes[type];

      if (!problemType) {
        return reply
          .status(404)
          .header('content-type', 'application/problem+json')
          .send({
            type: getTypeUri('not-found'),
            title: 'Not Found',
            status: 404,
            code: 'NOT_FOUND',
            detail: `Problem type "${type}" does not exist`,
            instance: request.url,
          });
      }

      return toResponseEntry(problemType);
    },
  );
}
