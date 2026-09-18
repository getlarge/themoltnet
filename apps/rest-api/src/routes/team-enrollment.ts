import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  type AgentKeyServiceDeps,
  type AgentKeyWithSecret,
  createAgentKeyService,
} from '@moltnet/agent-key-service';
import { KetoNamespace } from '@moltnet/auth';
import {
  buildTeamEnrollmentMessage,
  ConflictProblemDetailsSchema,
  JoinTeamResponseSchema,
  ProblemDetailsSchema,
} from '@moltnet/models';
import type { IdentityApi } from '@ory/client-fetch';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';

import { createProblem } from '../problems/index.js';
import { AgentKeyWithSecretSchema } from '../schemas/agent-keys.js';
import { enrollTeamAgent } from '../services/team-enrollment.service.js';
import { verifyRegistrationProof } from '../utils/registration-proof.js';
import { requestAbortSignal } from '../utils/request-abort-signal.js';

/** Existing-identity proof authentication works even after every API key expires. */
export async function teamEnrollmentRoutes(
  fastify: FastifyInstance,
  options: {
    talosApi?: AgentKeyServiceDeps['talosApi'];
    identityApi: Pick<IdentityApi, 'getIdentity'>;
  },
) {
  const keys = createAgentKeyService({
    agentRepository: fastify.agentRepository,
    permissionChecker: fastify.permissionChecker,
    relationshipReader: fastify.relationshipReader,
    talosApi: options.talosApi,
  });
  fastify.withTypeProvider<TypeBoxTypeProvider>().post(
    '/auth/enroll-team',
    {
      config: { rateLimit: fastify.rateLimitConfig?.registration },
      schema: {
        operationId: 'enrollExistingAgent',
        tags: ['auth'],
        description:
          'Enroll an existing active agent using its current signing key and an invitation. Returns a team-bound credential once. Completed replays return 409 with the issued key identifier.',
        body: Type.Object({
          subjectId: Type.String({ format: 'uuid' }),
          code: Type.String({ pattern: '^mlt_inv_[A-Za-z0-9_-]{22}$' }),
          proof: Type.String({ minLength: 1, maxLength: 256 }),
          expectedTeamId: Type.Optional(Type.String({ format: 'uuid' })),
        }),
        headers: Type.Object({
          'idempotency-key': Type.String({
            minLength: 1,
            maxLength: 200,
            pattern: '\\S',
          }),
        }),
        response: {
          200: Type.Object({
            ...JoinTeamResponseSchema.properties,
            agentKey: Type.Unsafe<AgentKeyWithSecret>(
              Type.Ref(AgentKeyWithSecretSchema.$id),
            ),
          }),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ConflictProblemDetailsSchema.$id),
          410: Type.Ref(ProblemDetailsSchema.$id),
          429: Type.Ref(ProblemDetailsSchema.$id),
          502: Type.Ref(ProblemDetailsSchema.$id),
          503: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const input = {
        ...request.body,
        idempotencyKey: request.headers['idempotency-key'],
      };
      const agent = await fastify.agentRepository.findById(input.subjectId);
      if (!agent?.identityId || agent.id !== input.subjectId) {
        throw createProblem('unauthorized');
      }
      await verifyRegistrationProof(fastify.cryptoService, {
        publicKey: agent.publicKey,
        proof: input.proof,
        message: buildTeamEnrollmentMessage(input),
      });
      const signal = requestAbortSignal(request, reply);
      const identity = await options.identityApi.getIdentity(
        { id: agent.identityId },
        { signal },
      );
      if (identity.state !== 'active') throw createProblem('unauthorized');
      if (!options.talosApi) throw createProblem('service-unavailable');
      return enrollTeamAgent(
        { teamRepository: fastify.teamRepository, log: request.log },
        keys,
        {
          ...input,
          proofAuthenticated: true,
          subjectNs: KetoNamespace.Agent,
          signal,
        },
      );
    },
  );
}
