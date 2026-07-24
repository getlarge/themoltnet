import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth } from '@moltnet/auth';
import {
  ProblemDetailsSchema,
  TeamHeaderRequiredSchema,
} from '@moltnet/models';
import type { ApiKeysApi } from '@ory/client-fetch';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from 'typebox';

import { createProblem } from '../problems/index.js';
import {
  AgentKeyListSchema,
  AgentKeyParamsSchema,
  AgentKeyStatusSchema,
  AgentKeyWithSecretSchema,
  CreateAgentKeyBodySchema,
  RevokeAgentKeyBodySchema,
} from '../schemas.js';
import {
  type AgentKeySubject,
  createAgentKeyService,
} from '../services/agent-keys.js';
import { requireCurrentTeamId } from '../utils/require-current-team-id.js';

interface AgentKeyRoutesOptions {
  talosApi?: Pick<
    ApiKeysApi,
    | 'adminGetIssuedApiKey'
    | 'adminIssueApiKey'
    | 'adminListIssuedApiKeys'
    | 'adminRevokeIssuedApiKey'
    | 'adminRotateIssuedApiKey'
  >;
}

function authSubject(request: FastifyRequest): AgentKeySubject {
  const auth = request.authContext;
  if (!auth) throw createProblem('unauthorized');
  return {
    identityId: auth.identityId,
    subjectType: auth.subjectType,
    subjectNs:
      auth.subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent,
  };
}

export async function agentKeyRoutes(
  fastify: FastifyInstance,
  options: AgentKeyRoutesOptions,
) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  const agentKeys = createAgentKeyService({
    agentRepository: fastify.agentRepository,
    permissionChecker: fastify.permissionChecker,
    relationshipReader: fastify.relationshipReader,
    talosApi: options.talosApi,
  });
  server.addHook('preHandler', requireAuth);

  server.post(
    '/agent-keys',
    {
      config: { auth: { talosCredentialScope: 'team' } },
      schema: {
        operationId: 'createAgentKey',
        tags: ['agent-keys'],
        description:
          'Issue a secret API key bound to one agent and the active team.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        body: CreateAgentKeyBodySchema,
        response: {
          201: Type.Ref(AgentKeyWithSecretSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          502: Type.Ref(ProblemDetailsSchema.$id),
          503: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const teamId = requireCurrentTeamId(request, 'agent keys');
      const result = await agentKeys.issue({
        ...request.body,
        logger: request.log,
        subject: authSubject(request),
        teamId,
      });
      return reply.status(201).send(result);
    },
  );

  server.get(
    '/agent-keys',
    {
      config: {
        auth: { talosCredentialScope: 'team' },
        rateLimit: fastify.rateLimitConfig.read,
      },
      schema: {
        operationId: 'listAgentKeys',
        tags: ['agent-keys'],
        description:
          'List agent API keys bound to the active team. Team credential managers may list every agent.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        querystring: Type.Object({
          agentId: Type.Optional(Type.String({ format: 'uuid' })),
          status: Type.Optional(AgentKeyStatusSchema),
          pageSize: Type.Optional(
            Type.Integer({ minimum: 1, maximum: 100, default: 20 }),
          ),
          pageToken: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Ref(AgentKeyListSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          502: Type.Ref(ProblemDetailsSchema.$id),
          503: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const teamId = requireCurrentTeamId(request, 'agent keys');
      return agentKeys.list({
        ...request.query,
        logger: request.log,
        subject: authSubject(request),
        teamId,
      });
    },
  );

  server.post(
    '/agent-keys/:keyId/rotate',
    {
      config: { auth: { talosCredentialScope: 'team' } },
      schema: {
        operationId: 'rotateAgentKey',
        tags: ['agent-keys'],
        description:
          'Rotate an agent API key immediately. The previous secret is revoked and expiry is unchanged.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        params: AgentKeyParamsSchema,
        response: {
          200: Type.Ref(AgentKeyWithSecretSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          502: Type.Ref(ProblemDetailsSchema.$id),
          503: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const teamId = requireCurrentTeamId(request, 'agent keys');
      return agentKeys.rotate({
        keyId: request.params.keyId,
        logger: request.log,
        subject: authSubject(request),
        teamId,
      });
    },
  );

  server.post(
    '/agent-keys/:keyId/revoke',
    {
      config: { auth: { talosCredentialScope: 'team' } },
      schema: {
        operationId: 'revokeAgentKey',
        tags: ['agent-keys'],
        description: 'Permanently revoke an agent API key.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        params: AgentKeyParamsSchema,
        body: RevokeAgentKeyBodySchema,
        response: {
          204: Type.Null(),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          502: Type.Ref(ProblemDetailsSchema.$id),
          503: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const teamId = requireCurrentTeamId(request, 'agent keys');
      await agentKeys.revoke({
        ...request.body,
        keyId: request.params.keyId,
        logger: request.log,
        subject: authSubject(request),
        teamId,
      });
      return reply.status(204).send(null);
    },
  );
}
