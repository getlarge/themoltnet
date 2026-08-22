import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  type AgentKeyOperationBinding,
  type AgentKeySubject,
  createAgentKeyService,
} from '@moltnet/agent-key-service';
import { requireAuth, TEAM_HEADER } from '@moltnet/auth';
import {
  ProblemDetailsSchema,
  TeamHeaderOptionalSchema,
  ValidationProblemDetailsSchema,
} from '@moltnet/models';
import type { ApiKeysApi } from '@ory/client-fetch';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from 'typebox';

import { createProblem, createValidationProblem } from '../problems/index.js';
import {
  AgentKeyBindingQuerySchema,
  AgentKeyListSchema,
  AgentKeyParamsSchema,
  AgentKeyStatusSchema,
  AgentKeyWithSecretSchema,
  CreateAgentKeyBodySchema,
  RevokeAgentKeyBodySchema,
} from '../schemas.js';
import { requestAbortSignal } from '../utils/request-abort-signal.js';
import { requireKetoSubject } from '../utils/require-keto-subject.js';

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
    ...requireKetoSubject(request),
    scopes: auth.scopes,
    ...(auth.subjectType === 'agent' && auth.credentialBinding
      ? {
          credentialBindingScope: auth.credentialBinding.bindingScope,
          credentialKeyId: auth.credentialBinding.keyId,
        }
      : {}),
  };
}

const AgentKeyIssueHeadersSchema = Type.Intersect([
  TeamHeaderOptionalSchema,
  Type.Object({
    'idempotency-key': Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: '\\S',
      description:
        'Caller-generated retry key. Reuse it only for the same issue request.',
    }),
  }),
]);

function operationBinding(
  request: FastifyRequest,
  bindingScope: 'identity' | 'team' | undefined,
): AgentKeyOperationBinding {
  if (bindingScope === 'identity') {
    if (request.headers[TEAM_HEADER] !== undefined) {
      throw createValidationProblem(
        [
          {
            field: TEAM_HEADER,
            message: 'must be omitted for identity-scoped agent keys',
          },
        ],
        `${TEAM_HEADER} header is not allowed for identity-scoped agent keys`,
      );
    }
    return { bindingScope: 'identity' };
  }
  const teamId = request.authContext?.currentTeamId;
  if (!teamId) {
    throw createValidationProblem(
      [
        {
          field: TEAM_HEADER,
          message: 'is required for team-scoped agent keys',
        },
      ],
      `${TEAM_HEADER} header is required: agent keys are team-scoped`,
    );
  }
  return {
    bindingScope: 'team',
    teamId,
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
      onRequest: fastify.rateLimitHooks.agentKey,
      config: {
        auth: {
          credentialBindingScope: 'identity',
          requiredScopes: ['key:manage'],
        },
        rateLimit: false,
        rateLimitBucket: 'agent-key',
      },
      schema: {
        operationId: 'createAgentKey',
        tags: ['agent-keys'],
        description:
          'Issue a secret API key bound to one agent identity or, by default, the active team.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: AgentKeyIssueHeadersSchema,
        body: CreateAgentKeyBodySchema,
        response: {
          201: Type.Ref(AgentKeyWithSecretSchema.$id),
          400: Type.Ref(ValidationProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ProblemDetailsSchema.$id),
          429: Type.Ref(ProblemDetailsSchema.$id),
          502: Type.Ref(ProblemDetailsSchema.$id),
          503: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const { bindingScope, ...body } = request.body;
      const binding = operationBinding(request, bindingScope);
      const result = await agentKeys.issue({
        ...body,
        ...binding,
        idempotencyKey: request.headers['idempotency-key'],
        logger: request.log,
        signal: requestAbortSignal(request, reply),
        subject: authSubject(request),
      });
      return reply.status(201).send(result);
    },
  );

  server.get(
    '/agent-keys',
    {
      config: {
        auth: {
          credentialBindingScope: 'identity',
          requiredScopes: ['key:manage'],
        },
        rateLimit: fastify.rateLimitConfig.read,
      },
      schema: {
        operationId: 'listAgentKeys',
        tags: ['agent-keys'],
        description:
          'List agent API keys for the selected binding. Team scope is the default; identity scope is agent self-service.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderOptionalSchema,
        querystring: Type.Intersect([
          AgentKeyBindingQuerySchema,
          Type.Object({
            agentId: Type.Optional(Type.String({ format: 'uuid' })),
            status: Type.Optional(AgentKeyStatusSchema),
            limit: Type.Optional(
              Type.Integer({ minimum: 1, maximum: 100, default: 20 }),
            ),
            cursor: Type.Optional(Type.String()),
          }),
        ]),
        response: {
          200: Type.Ref(AgentKeyListSchema.$id),
          400: Type.Ref(ValidationProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          502: Type.Ref(ProblemDetailsSchema.$id),
          503: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const { bindingScope, ...query } = request.query;
      const binding = operationBinding(request, bindingScope);
      return agentKeys.list({
        ...query,
        ...binding,
        logger: request.log,
        signal: requestAbortSignal(request, reply),
        subject: authSubject(request),
      });
    },
  );

  server.post(
    '/agent-keys/:keyId/rotate',
    {
      onRequest: fastify.rateLimitHooks.agentKey,
      config: {
        auth: {
          credentialBindingScope: 'identity',
          requiredScopes: ['key:manage'],
        },
        rateLimit: false,
        rateLimitBucket: 'agent-key',
      },
      schema: {
        operationId: 'rotateAgentKey',
        tags: ['agent-keys'],
        description:
          'Rotate an agent API key immediately. The previous secret is revoked and expiry is unchanged.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderOptionalSchema,
        params: AgentKeyParamsSchema,
        querystring: AgentKeyBindingQuerySchema,
        response: {
          200: Type.Ref(AgentKeyWithSecretSchema.$id),
          400: Type.Ref(ValidationProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ProblemDetailsSchema.$id),
          429: Type.Ref(ProblemDetailsSchema.$id),
          502: Type.Ref(ProblemDetailsSchema.$id),
          503: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const binding = operationBinding(request, request.query.bindingScope);
      const rotated = await agentKeys.rotate({
        ...binding,
        keyId: request.params.keyId,
        logger: request.log,
        signal: requestAbortSignal(request, reply),
        subject: authSubject(request),
      });
      fastify.tokenValidator.evictTalosKey(request.params.keyId);
      return rotated;
    },
  );

  server.post(
    '/agent-keys/:keyId/revoke',
    {
      onRequest: fastify.rateLimitHooks.agentKey,
      config: {
        auth: { credentialBindingScope: 'identity', requiredScopes: [] },
        rateLimit: false,
        rateLimitBucket: 'agent-key',
      },
      schema: {
        operationId: 'revokeAgentKey',
        tags: ['agent-keys'],
        description: 'Permanently revoke an agent API key.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderOptionalSchema,
        params: AgentKeyParamsSchema,
        querystring: AgentKeyBindingQuerySchema,
        body: RevokeAgentKeyBodySchema,
        response: {
          204: Type.Null(),
          400: Type.Ref(ValidationProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          429: Type.Ref(ProblemDetailsSchema.$id),
          502: Type.Ref(ProblemDetailsSchema.$id),
          503: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const binding = operationBinding(request, request.query.bindingScope);
      await agentKeys.revoke({
        ...request.body,
        ...binding,
        keyId: request.params.keyId,
        logger: request.log,
        subject: authSubject(request),
        signal: requestAbortSignal(request, reply),
      });
      fastify.tokenValidator.evictTalosKey(request.params.keyId);
      return reply.status(204).send(null);
    },
  );
}
