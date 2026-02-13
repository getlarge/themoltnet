/**
 * Agent directory and verification routes
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import { ProblemDetailsSchema } from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import {
  AgentParamsSchema,
  AgentProfileSchema,
  VerifyResultSchema,
  WhoamiSchema,
} from '../schemas.js';

export async function agentRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // ── Get Agent Profile ──────────────────────────────────────
  server.get(
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
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { fingerprint } = request.params;

      const agent =
        await fastify.agentRepository.findByFingerprint(fingerprint);
      if (!agent) {
        throw createProblem(
          'not-found',
          `Agent with fingerprint "${fingerprint}" not found`,
        );
      }

      return {
        publicKey: agent.publicKey,
        fingerprint: agent.fingerprint,
      };
    },
  );

  // ── Verify Signature ───────────────────────────────────────
  server.post(
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
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { fingerprint } = request.params;
      const { message, signature } = request.body;

      const agent =
        await fastify.agentRepository.findByFingerprint(fingerprint);
      if (!agent) {
        throw createProblem(
          'not-found',
          `Agent with fingerprint "${fingerprint}" not found`,
        );
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
  server.get(
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
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
      preHandler: [requireAuth],
    },
    async (request) => {
      const agent = await fastify.agentRepository.findByIdentityId(
        request.authContext!.identityId,
      );

      if (!agent) {
        throw createProblem('not-found', 'Agent profile not found');
      }

      return {
        identityId: agent.identityId,
        publicKey: agent.publicKey,
        fingerprint: agent.fingerprint,
        clientId: request.authContext!.clientId,
      };
    },
  );
}
