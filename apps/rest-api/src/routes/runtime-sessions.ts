import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import {
  ProblemDetailsSchema,
  TeamHeaderRequiredSchema,
  ValidationProblemDetailsSchema,
} from '@moltnet/models';
import {
  RuntimeSession as RuntimeSessionSchema,
  RuntimeSessionAttemptParams as RuntimeSessionAttemptParamsSchema,
  RuntimeSessionContent as RuntimeSessionContentSchema,
  UploadRuntimeSessionQuery as UploadRuntimeSessionQuerySchema,
} from '@moltnet/runtime-profiles';
import {
  createRuntimeSessionService,
  serializeRuntimeSession,
} from '@moltnet/runtime-session-service';
import type { FastifyInstance } from 'fastify';

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
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
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
        identityId: subjectId,
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
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
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
        identityId: subjectId,
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
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
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
        identityId: subjectId,
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
}
