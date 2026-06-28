import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth } from '@moltnet/auth';
import {
  ConflictProblemDetailsSchema,
  ProblemDetailsSchema,
  TeamHeaderRequiredSchema,
  ValidationProblemDetailsSchema,
} from '@moltnet/models';
import {
  createTaskArtifactService,
  serializeTaskArtifact,
  TaskArtifactServiceError,
} from '@moltnet/task-artifact-service';
import {
  ListTaskArtifactsQuery as ListTaskArtifactsQuerySchema,
  TaskArtifact as TaskArtifactSchema,
  TaskArtifactAttemptParams as TaskArtifactAttemptParamsSchema,
  TaskArtifactContent as TaskArtifactContentSchema,
  TaskArtifactContentParams as TaskArtifactContentParamsSchema,
  TaskArtifactList as TaskArtifactListSchema,
  TaskArtifactTaskParams as TaskArtifactTaskParamsSchema,
  UploadTaskArtifactQuery as UploadTaskArtifactQuerySchema,
} from '@moltnet/tasks';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';

import {
  createConflictProblem,
  createProblem,
  createValidationProblem,
} from '../problems/index.js';
import { requireCurrentTeamId } from '../utils/require-current-team-id.js';

function authSubject(request: {
  authContext: {
    identityId: string;
    subjectType: 'agent' | 'human';
    currentTeamId: string | null;
  } | null;
}) {
  const auth = request.authContext;
  if (!auth) {
    throw createProblem('unauthorized', 'Authentication context missing');
  }
  return {
    identityId: auth.identityId,
    subjectNs:
      auth.subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent,
    subjectType: auth.subjectType,
  };
}

function toArtifactProblem(
  error: TaskArtifactServiceError,
  field: 'body' | 'query' = 'body',
) {
  if (error.statusCode === 400) {
    return createValidationProblem(
      [{ field, message: error.message }],
      error.message,
    );
  }
  if (error.statusCode === 403)
    return createProblem('forbidden', error.message);
  if (error.statusCode === 404)
    return createProblem('not-found', error.message);
  if (error.statusCode === 409) return createConflictProblem(error.message);
  if (error.statusCode === 503) {
    return createProblem('service-unavailable', error.message);
  }
  return createProblem('internal-server-error', error.message);
}

function normalizeContentType(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

const deferInaccessibleTeamAuthorization = {
  // Let the artifact service perform resource-scoped checks so inaccessible
  // tasks/artifacts are hidden as 404 instead of leaking team membership via
  // the auth plugin's generic 403.
  auth: { deferInaccessibleTeamAuthorization: true },
};

export async function taskArtifactRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  const taskArtifacts = createTaskArtifactService({
    logger: fastify.log,
    objectStorage: fastify.taskArtifactStorage,
    permissionChecker: fastify.permissionChecker,
    taskArtifactMaxBytes: fastify.taskArtifactMaxBytes,
    taskArtifactRepository: fastify.taskArtifactRepository,
    taskRepository: fastify.taskRepository,
  });

  server.addHook('preHandler', requireAuth);
  if (!fastify.hasContentTypeParser('application/octet-stream')) {
    fastify.addContentTypeParser(
      'application/octet-stream',
      (_request, payload, done) => {
        done(null, payload);
      },
    );
  }

  server.put(
    '/tasks/:taskId/attempts/:attemptN/artifacts',
    {
      config: {
        ...deferInaccessibleTeamAuthorization,
        rateLimit: fastify.rateLimitConfig.taskArtifactUpload,
        swaggerTransform: ({ schema, url }) => ({
          schema: {
            ...schema,
            body: TaskArtifactContentSchema,
          },
          url,
        }),
      },
      schema: {
        operationId: 'uploadTaskArtifact',
        tags: ['task-artifacts'],
        description:
          'Upload immutable content-addressed artifact content for a task attempt.',
        consumes: ['application/octet-stream'],
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        params: TaskArtifactAttemptParamsSchema,
        querystring: UploadTaskArtifactQuerySchema,
        response: {
          200: TaskArtifactSchema,
          400: ValidationProblemDetailsSchema,
          401: ProblemDetailsSchema,
          403: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
          409: Type.Ref(ConflictProblemDetailsSchema.$id),
          503: ProblemDetailsSchema,
        },
      },
    },
    async (request) => {
      const { identityId, subjectNs, subjectType } = authSubject(request);
      if (subjectType !== 'agent') {
        throw createProblem(
          'forbidden',
          'Task artifacts can only be uploaded by agents',
        );
      }
      try {
        const artifact = await taskArtifacts.upload({
          attemptN: request.params.attemptN,
          body: request.body,
          contentEncoding: request.query.contentEncoding ?? null,
          contentType:
            request.query.contentType ??
            normalizeContentType(request.headers['content-type']) ??
            'application/octet-stream',
          identityId,
          kind: request.query.kind,
          subjectNs,
          taskId: request.params.taskId,
          teamId: requireCurrentTeamId(request, 'task artifacts'),
          title: request.query.title,
        });
        return serializeTaskArtifact(artifact);
      } catch (error) {
        if (error instanceof TaskArtifactServiceError) {
          throw toArtifactProblem(error);
        }
        throw error;
      }
    },
  );

  server.get(
    '/tasks/:taskId/artifacts',
    {
      config: {
        ...deferInaccessibleTeamAuthorization,
        rateLimit: fastify.rateLimitConfig.read,
      },
      schema: {
        operationId: 'listTaskArtifacts',
        tags: ['task-artifacts'],
        description: 'List task artifact metadata for the current team.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        params: TaskArtifactTaskParamsSchema,
        querystring: ListTaskArtifactsQuerySchema,
        response: {
          200: TaskArtifactListSchema,
          400: ValidationProblemDetailsSchema,
          401: ProblemDetailsSchema,
          403: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
        },
      },
    },
    async (request) => {
      const { identityId, subjectNs } = authSubject(request);
      try {
        const result = await taskArtifacts.listForTask({
          cursor: request.query.cursor,
          identityId,
          limit: request.query.limit,
          subjectNs,
          taskId: request.params.taskId,
          teamId: requireCurrentTeamId(request, 'task artifacts'),
        });
        return {
          artifacts: result.artifacts.map(serializeTaskArtifact),
          nextCursor: result.nextCursor,
        };
      } catch (error) {
        if (error instanceof TaskArtifactServiceError) {
          throw toArtifactProblem(error, 'query');
        }
        throw error;
      }
    },
  );

  server.get(
    '/tasks/:taskId/attempts/:attemptN/artifacts/:cid/content',
    {
      config: {
        ...deferInaccessibleTeamAuthorization,
        rateLimit: fastify.rateLimitConfig.read,
      },
      schema: {
        operationId: 'downloadTaskArtifact',
        tags: ['task-artifacts'],
        description: 'Download immutable task artifact content by CID.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        params: TaskArtifactContentParamsSchema,
        response: {
          200: {
            content: {
              'application/octet-stream': {
                schema: TaskArtifactContentSchema,
              },
            },
            description: 'Task artifact content stream.',
            headers: {
              'x-moltnet-task-artifact-id': {
                type: 'string',
                description: 'Artifact metadata row id.',
              },
              'x-moltnet-task-artifact-cid': {
                type: 'string',
                description: 'CIDv1 raw-bytes identifier for the artifact.',
              },
              'x-moltnet-task-artifact-content-type': {
                type: 'string',
                description: 'Content type recorded at upload time.',
              },
              'x-moltnet-task-artifact-content-encoding': {
                type: 'string',
                description:
                  'Content encoding recorded at upload time, empty when unset.',
              },
            },
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
      const { identityId, subjectNs } = authSubject(request);
      try {
        const { artifact, stream } = await taskArtifacts.download({
          attemptN: request.params.attemptN,
          cid: request.params.cid,
          identityId,
          subjectNs,
          taskId: request.params.taskId,
          teamId: requireCurrentTeamId(request, 'task artifacts'),
        });
        return await reply
          .header('x-moltnet-task-artifact-id', artifact.id)
          .header('x-moltnet-task-artifact-cid', artifact.cid)
          .header('x-moltnet-task-artifact-content-type', artifact.contentType)
          .header(
            'x-moltnet-task-artifact-content-encoding',
            artifact.contentEncoding ?? '',
          )
          .type('application/octet-stream')
          .send(stream as never);
      } catch (error) {
        if (error instanceof TaskArtifactServiceError) {
          throw toArtifactProblem(error);
        }
        throw error;
      }
    },
  );
}
