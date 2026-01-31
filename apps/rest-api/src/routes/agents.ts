/**
 * Agent directory and verification routes
 */

import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import {
  AgentParamsSchema,
  ErrorSchema,
  AgentProfileSchema,
  WhoamiSchema,
  VerifyResultSchema,
} from '../schemas.js';

export async function agentRoutes(fastify: FastifyInstance) {
  // ── Get Agent Profile ──────────────────────────────────────
  fastify.get(
    '/agents/:moltbookName',
    {
      schema: {
        operationId: 'getAgentProfile',
        tags: ['agents'],
        description: "Get an agent's public profile by Moltbook name.",
        params: AgentParamsSchema,
        response: {
          200: Type.Ref(AgentProfileSchema),
          404: Type.Ref(ErrorSchema),
        },
      },
    },
    async (request, reply) => {
      const { moltbookName } = request.params as { moltbookName: string };

      const agent =
        await fastify.agentRepository.findByMoltbookName(moltbookName);
      if (!agent) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Agent "${moltbookName}" not found`,
          statusCode: 404,
        });
      }

      return {
        moltbookName: agent.moltbookName,
        publicKey: agent.publicKey,
        fingerprint: agent.fingerprint,
        moltbookVerified: !!agent.moltbookVerified,
      };
    },
  );

  // ── Verify Signature ───────────────────────────────────────
  fastify.post(
    '/agents/:moltbookName/verify',
    {
      schema: {
        operationId: 'verifyAgentSignature',
        tags: ['agents'],
        description:
          "Verify a message signature using an agent's registered public key.",
        params: AgentParamsSchema,
        body: Type.Object({
          message: Type.String({ minLength: 1, maxLength: 10000 }),
          signature: Type.String({ minLength: 1 }),
        }),
        response: {
          200: Type.Ref(VerifyResultSchema),
          404: Type.Ref(ErrorSchema),
        },
      },
    },
    async (request, reply) => {
      const { moltbookName } = request.params as { moltbookName: string };
      const { message, signature } = request.body as {
        message: string;
        signature: string;
      };

      const agent =
        await fastify.agentRepository.findByMoltbookName(moltbookName);
      if (!agent) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Agent "${moltbookName}" not found`,
          statusCode: 404,
        });
      }

      const valid = await fastify.cryptoService.verify(
        message,
        signature,
        agent.publicKey,
      );

      return {
        valid,
        signer: valid
          ? {
              moltbookName: agent.moltbookName,
              fingerprint: agent.fingerprint,
            }
          : undefined,
      };
    },
  );

  // ── Who Am I ───────────────────────────────────────────────
  fastify.get(
    '/agents/whoami',
    {
      schema: {
        operationId: 'getWhoami',
        tags: ['agents'],
        description:
          'Get the authenticated agent identity (requires bearer token).',
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Ref(WhoamiSchema),
          401: Type.Ref(ErrorSchema),
          404: Type.Ref(ErrorSchema),
        },
      },
    },
    async (request, reply) => {
      if (!request.authContext) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required',
          statusCode: 401,
        });
      }

      const agent = await fastify.agentRepository.findByIdentityId(
        request.authContext.identityId,
      );

      if (!agent) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'Agent profile not found',
          statusCode: 404,
        });
      }

      return {
        identityId: agent.identityId,
        moltbookName: agent.moltbookName,
        publicKey: agent.publicKey,
        fingerprint: agent.fingerprint,
        moltbookVerified: !!agent.moltbookVerified,
      };
    },
  );
}
