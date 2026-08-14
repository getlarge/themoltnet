import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import {
  ProblemDetailsSchema,
  TeamHeaderRequiredSchema,
} from '@moltnet/models';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';

import { createProblem } from '../problems/index.js';
import {
  AgentEnrollmentParamsSchema,
  CreatedAgentEnrollmentSchema,
} from '../schemas.js';
import { authContextToCreator } from '../utils/auth-principal.js';
import { requireCurrentTeamId } from '../utils/require-current-team-id.js';
import { requireKetoSubject } from '../utils/require-keto-subject.js';

const CreateAgentEnrollmentBodySchema = Type.Object({
  expiresInMinutes: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 60, default: 15 }),
  ),
});

export async function agentEnrollmentRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

  server.post(
    '/agent-enrollments',
    {
      config: {
        auth: {
          credentialBindingScope: 'team',
          requiredScopes: ['team:manage'],
        },
      },
      schema: {
        operationId: 'createAgentEnrollment',
        tags: ['agent-enrollments'],
        description:
          'Create a single-use agent enrollment for the active team. Requires Team#manage_members. The raw token is returned once and only its SHA-256 hash is stored.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        body: CreateAgentEnrollmentBodySchema,
        response: {
          201: Type.Ref(CreatedAgentEnrollmentSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const teamId = requireCurrentTeamId(request, 'agent enrollments');
      const { identityId, subjectNs } = requireKetoSubject(request);
      const canManage = await fastify.permissionChecker.canManageTeamMembers(
        teamId,
        identityId,
        subjectNs,
      );
      if (!canManage) throw createProblem('forbidden');

      const team = await fastify.teamRepository.findById(teamId);
      if (!team) throw createProblem('not-found');
      if (team.personal) throw createProblem('team-personal-immutable');

      const expiresInMinutes = request.body.expiresInMinutes ?? 15;
      const { enrollment, token } =
        await fastify.agentEnrollmentRepository.create({
          creator: authContextToCreator(request),
          teamId,
          expiresAt: new Date(Date.now() + expiresInMinutes * 60_000),
        });

      return reply.status(201).send({
        id: enrollment.id,
        teamId: enrollment.teamId,
        expiresAt: enrollment.expiresAt,
        redeemedAt: enrollment.redeemedAt,
        revokedAt: enrollment.revokedAt,
        resultingAgentId: enrollment.resultingAgentId,
        createdAt: enrollment.createdAt,
        token,
      });
    },
  );

  server.delete(
    '/agent-enrollments/:id',
    {
      config: {
        auth: {
          credentialBindingScope: 'team',
          requiredScopes: ['team:manage'],
        },
      },
      schema: {
        operationId: 'revokeAgentEnrollment',
        tags: ['agent-enrollments'],
        description:
          'Revoke an unused agent enrollment. Requires Team#manage_members.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        params: AgentEnrollmentParamsSchema,
        response: {
          204: Type.Null(),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const teamId = requireCurrentTeamId(request, 'agent enrollments');
      const { identityId, subjectNs } = requireKetoSubject(request);
      const canManage = await fastify.permissionChecker.canManageTeamMembers(
        teamId,
        identityId,
        subjectNs,
      );
      if (!canManage) throw createProblem('forbidden');

      const revoked = await fastify.agentEnrollmentRepository.revoke(
        request.params.id,
        teamId,
      );
      if (!revoked) throw createProblem('not-found');
      return reply.status(204).send(null);
    },
  );
}
