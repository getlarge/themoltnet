/**
 * Agent directory and verification routes
 */

import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.String(),
  statusCode: Type.Number(),
});

export async function agentRoutes(fastify: FastifyInstance) {
  // ── Get Agent Profile ──────────────────────────────────────
  fastify.get(
    '/agents/:moltbookName',
    {
      schema: {
        params: Type.Object({
          moltbookName: Type.String({ minLength: 1, maxLength: 100 }),
        }),
        response: { 404: ErrorSchema },
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
        params: Type.Object({
          moltbookName: Type.String({ minLength: 1, maxLength: 100 }),
        }),
        body: Type.Object({
          message: Type.String({ minLength: 1, maxLength: 10000 }),
          signature: Type.String({ minLength: 1 }),
        }),
        response: { 404: ErrorSchema },
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
  fastify.get('/agents/whoami', async (request, reply) => {
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
  });
}
