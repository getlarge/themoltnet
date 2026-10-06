import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import {
  ProblemDetailsSchema,
  TeamHeaderRequiredSchema,
  ValidationProblemDetailsSchema,
} from '@moltnet/models';
import {
  AppendRuntimeStoreCommit,
  RuntimeSession as RuntimeSessionSchema,
  RuntimeSessionAttemptParams as RuntimeSessionAttemptParamsSchema,
  RuntimeSessionContent as RuntimeSessionContentSchema,
  RuntimeStoreAttemptQuery,
  RuntimeStoreAttemptResponse,
  RuntimeStoreAuthority,
  RuntimeStoreCommitPage,
  RuntimeStoreCommitReceipt,
  RuntimeStoreHandle,
  RuntimeStoreIdAllocation,
  RuntimeStoreParams,
  RuntimeStoreReadQuery,
  RuntimeStoreWriter,
  UploadRuntimeSessionQuery as UploadRuntimeSessionQuerySchema,
} from '@moltnet/runtime-profiles';
import {
  createRuntimeSessionService,
  createRuntimeStoreService,
  serializeRuntimeSession,
} from '@moltnet/runtime-session-service';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from 'typebox';

import { PRINCIPAL_AUTH_SECURITY } from '../openapi-security.js';
import { createProblem } from '../problems/index.js';
import { requireCurrentTeamId } from '../utils/require-current-team-id.js';
import { requireKetoSubject } from '../utils/require-keto-subject.js';

export async function runtimeSessionRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  const runtimeSessions = createRuntimeSessionService({
    logger: fastify.log,
    permissionChecker: fastify.permissionChecker,
    runtimeProfileRepository: fastify.runtimeProfileRepository,
    runtimeSessionMaxBytes: fastify.runtimeSessionMaxBytes,
    runtimeSessionRepository: fastify.runtimeSessionRepository,
    runtimeSessionStorage: fastify.runtimeSessionStorage,
    runtimeSlotRepository: fastify.runtimeSlotRepository,
    taskRepository: fastify.taskRepository,
  });

  server.addHook('preHandler', requireAuth);
  fastify.addContentTypeParser(
    ['application/x-ndjson', 'application/octet-stream'],
    (_request, payload, done) => {
      done(null, payload);
    },
  );

  server.put(
    '/runtime-sessions/:taskId/:attemptN/content',
    {
      config: {
        auth: {
          credentialBindingScope: 'team',
          requiredScopes: ['task:execute'],
        },
        swaggerTransform: ({ schema, url }) => ({
          schema: {
            ...schema,
            body: RuntimeSessionContentSchema,
          },
          url,
        }),
      },
      schema: {
        operationId: 'uploadRuntimeSession',
        tags: ['runtime-sessions'],
        description:
          'Stream or replace the durable team-scoped runtime session content for a task attempt.',
        consumes: ['application/octet-stream'],
        security: PRINCIPAL_AUTH_SECURITY,
        headers: TeamHeaderRequiredSchema,
        params: RuntimeSessionAttemptParamsSchema,
        querystring: UploadRuntimeSessionQuerySchema,
        response: {
          200: RuntimeSessionSchema,
          400: ValidationProblemDetailsSchema,
          401: ProblemDetailsSchema,
          403: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
          409: ProblemDetailsSchema,
          503: ProblemDetailsSchema,
        },
      },
    },
    async (request) => {
      const { subjectId, subjectNs, subjectType } = requireKetoSubject(request);
      if (subjectType !== 'agent') {
        throw createProblem(
          'forbidden',
          'Runtime sessions can only be uploaded by agents',
        );
      }

      const session = await runtimeSessions.upload({
        attemptN: request.params.attemptN,
        body: request.body,
        subjectId,
        query: request.query,
        subjectNs,
        taskId: request.params.taskId,
        teamId: requireCurrentTeamId(request, 'runtime sessions'),
      });
      return serializeRuntimeSession(session);
    },
  );

  server.get(
    '/runtime-sessions/:taskId/:attemptN',
    {
      config: {
        auth: {
          credentialBindingScope: 'team',
          requiredScopes: ['task:execute'],
        },
        rateLimit: fastify.rateLimitConfig.read,
      },
      schema: {
        operationId: 'getRuntimeSession',
        tags: ['runtime-sessions'],
        description:
          'Get metadata for the durable team-scoped runtime session for a task attempt.',
        security: PRINCIPAL_AUTH_SECURITY,
        headers: TeamHeaderRequiredSchema,
        params: RuntimeSessionAttemptParamsSchema,
        response: {
          200: RuntimeSessionSchema,
          400: ValidationProblemDetailsSchema,
          401: ProblemDetailsSchema,
          403: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
        },
      },
    },
    async (request) => {
      const { subjectId, subjectNs } = requireKetoSubject(request);
      const session = await runtimeSessions.getMetadata({
        attemptN: request.params.attemptN,
        subjectId,
        subjectNs,
        taskId: request.params.taskId,
        teamId: requireCurrentTeamId(request, 'runtime sessions'),
      });
      return serializeRuntimeSession(session);
    },
  );

  server.get(
    '/runtime-sessions/:taskId/:attemptN/content',
    {
      config: {
        auth: {
          credentialBindingScope: 'team',
          requiredScopes: ['task:execute'],
        },
        rateLimit: fastify.rateLimitConfig.read,
      },
      schema: {
        operationId: 'downloadRuntimeSession',
        tags: ['runtime-sessions'],
        description:
          'Download the durable team-scoped runtime session content for a task attempt.',
        security: PRINCIPAL_AUTH_SECURITY,
        headers: TeamHeaderRequiredSchema,
        params: RuntimeSessionAttemptParamsSchema,
        response: {
          200: {
            content: {
              'application/octet-stream': {
                schema: RuntimeSessionContentSchema,
              },
            },
            description: 'Runtime session content stream.',
          },
          400: ValidationProblemDetailsSchema,
          401: ProblemDetailsSchema,
          403: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
          503: ProblemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const { subjectId, subjectNs } = requireKetoSubject(request);
      const { object, session, stream } = await runtimeSessions.download({
        attemptN: request.params.attemptN,
        subjectId,
        subjectNs,
        taskId: request.params.taskId,
        teamId: requireCurrentTeamId(request, 'runtime sessions'),
      });
      return reply
        .header('x-moltnet-runtime-session-id', session.id)
        .header('x-moltnet-runtime-session-sha256', session.sha256)
        .type(object.contentType ?? 'application/x-ndjson')
        .send(stream as never);
    },
  );
  await server.register(registerDurableSessionRoutes);
}

async function registerDurableSessionRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  const service = createRuntimeStoreService({
    repository: fastify.runtimeSessionRepository.durable,
    taskRepository: fastify.taskRepository,
    transactionRunner: fastify.transactionRunner,
    storage: fastify.runtimeSessionStorage,
    permissionChecker: fastify.permissionChecker,
    maxBytes: Math.min(fastify.runtimeSessionMaxBytes, 1024 * 1024),
  });
  const config = {
    rateLimitBucket: 'runtime-store',
    rateLimit: fastify.rateLimitConfig.runtimeStore,
    auth: {
      credentialBindingScope: 'team' as const,
      requiredScopes: ['task:execute'] as const,
    },
  };
  const common = {
    tags: ['runtime-sessions'],
    security: PRINCIPAL_AUTH_SECURITY,
    headers: TeamHeaderRequiredSchema,
  };
  const errors = {
    400: Type.Ref(ProblemDetailsSchema.$id),
    401: Type.Ref(ProblemDetailsSchema.$id),
    403: Type.Ref(ProblemDetailsSchema.$id),
    404: Type.Ref(ProblemDetailsSchema.$id),
    409: Type.Ref(ProblemDetailsSchema.$id),
    503: Type.Ref(ProblemDetailsSchema.$id),
  };
  const subject = (request: FastifyRequest) => ({
    ...requireKetoSubject(request),
    teamId: requireCurrentTeamId(request, 'runtime stores'),
  });
  const agent = (request: FastifyRequest) => {
    const value = subject(request);
    if (value.subjectType !== 'agent')
      throw createProblem('forbidden', 'Only agents may write runtime stores');
    return value;
  };
  server.get(
    '/runtime-sessions/durable/attempt',
    {
      config,
      schema: {
        ...common,
        operationId: 'getRuntimeStoreForAttempt',
        querystring: RuntimeStoreAttemptQuery,
        response: { ...errors, 200: RuntimeStoreAttemptResponse },
      },
    },
    (request) => service.findAttempt({ ...request.query, ...subject(request) }),
  );
  server.post(
    '/runtime-sessions/durable/open',
    {
      config,
      schema: {
        ...common,
        operationId: 'openRuntimeStore',
        body: RuntimeStoreAuthority,
        response: { ...errors, 200: RuntimeStoreHandle },
      },
    },
    (request) => service.open({ ...request.body, ...agent(request) }),
  );
  server.post(
    '/runtime-sessions/durable/:storeId/renew',
    {
      config,
      schema: {
        ...common,
        operationId: 'renewRuntimeStore',
        params: RuntimeStoreParams,
        body: RuntimeStoreWriter,
        response: { ...errors, 200: RuntimeStoreHandle },
      },
    },
    (request) =>
      service.renew({ ...request.body, ...request.params, ...agent(request) }),
  );
  server.post(
    '/runtime-sessions/durable/:storeId/release',
    {
      config,
      schema: {
        ...common,
        operationId: 'releaseRuntimeStore',
        params: RuntimeStoreParams,
        body: RuntimeStoreWriter,
        response: { ...errors, 204: { type: 'null' } },
      },
    },
    async (request, reply) => {
      await service.release({
        ...request.body,
        ...request.params,
        ...agent(request),
      });
      return reply.code(204).send();
    },
  );
  server.post(
    '/runtime-sessions/durable/:storeId/ids',
    {
      config,
      schema: {
        ...common,
        operationId: 'mintRuntimeStoreId',
        params: RuntimeStoreParams,
        body: RuntimeStoreWriter,
        response: { ...errors, 200: RuntimeStoreIdAllocation },
      },
    },
    async (request) => ({
      id: await service.mintId({
        ...request.body,
        ...request.params,
        ...agent(request),
      }),
    }),
  );
  server.post(
    '/runtime-sessions/durable/:storeId/commits',
    {
      config,
      schema: {
        ...common,
        operationId: 'appendRuntimeStoreCommit',
        params: RuntimeStoreParams,
        body: AppendRuntimeStoreCommit,
        response: { ...errors, 200: RuntimeStoreCommitReceipt },
      },
    },
    (request) =>
      service.append({ ...request.body, ...request.params, ...agent(request) }),
  );
  server.get(
    '/runtime-sessions/durable/:storeId/commits',
    {
      config,
      schema: {
        ...common,
        operationId: 'listRuntimeStoreCommits',
        params: RuntimeStoreParams,
        querystring: RuntimeStoreReadQuery,
        response: { ...errors, 200: RuntimeStoreCommitPage },
      },
    },
    (request) =>
      service.read({
        ...request.query,
        ...request.params,
        ...subject(request),
      }),
  );
}
