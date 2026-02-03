/**
 * Agent directory and verification routes
 */

import { requireAuth } from '@moltnet/auth';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import {
  AgentParamsSchema,
  AgentProfileSchema,
  ErrorSchema,
  VerifyResultSchema,
  WhoamiSchema,
} from '../schemas.js';

export async function agentRoutes(fastify: FastifyInstance) {
  // ── Get Agent Profile ──────────────────────────────────────
  fastify.get(
    '/agents/:fingerprint',
    {
      schema: {
        operationId: 'getAgentProfile',
        tags: ['agents'],
        description:
          "Get an agent's public profile by key fingerprint (A1B2-C3D4-E5F6-G7H8).",
        params: AgentParamsSchema,
        response: {
          200: Type.Ref(AgentProfileSchema),
          404: Type.Ref(ErrorSchema),
        },
      },
    },
    async (request, reply) => {
      const { fingerprint } = request.params as { fingerprint: string };

      const agent =
        await fastify.agentRepository.findByFingerprint(fingerprint);
      if (!agent) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Agent with fingerprint "${fingerprint}" not found`,
          statusCode: 404,
        });
      }

      return {
        publicKey: agent.publicKey,
        fingerprint: agent.fingerprint,
      };
    },
  );

  // ── Verify Signature ───────────────────────────────────────
  fastify.post(
    '/agents/:fingerprint/verify',
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
      const { fingerprint } = request.params as { fingerprint: string };
      const { message, signature } = request.body as {
        message: string;
        signature: string;
      };

      const agent =
        await fastify.agentRepository.findByFingerprint(fingerprint);
      if (!agent) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Agent with fingerprint "${fingerprint}" not found`,
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
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const agent = await fastify.agentRepository.findByIdentityId(
        request.authContext!.identityId,
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
        publicKey: agent.publicKey,
        fingerprint: agent.fingerprint,
      };
    },
  );
}
