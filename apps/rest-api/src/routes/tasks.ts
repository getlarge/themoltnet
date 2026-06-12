import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth } from '@moltnet/auth';
import {
  ProblemDetailsSchema,
  ValidationProblemDetailsSchema,
} from '@moltnet/models';
import {
  BUILT_IN_TASK_TYPES,
  normalizeTaskCreateRequest,
  Task,
  TASK_TYPE_SCHEMA_CIDS,
  TaskAttempt,
  TaskMessage,
} from '@moltnet/tasks';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';

import { createProblem, createValidationProblem } from '../problems/index.js';
import {
  AppendMessagesBodySchema,
  AppendMessagesResponseSchema,
  CancelTaskBodySchema,
  ClaimTaskBodySchema,
  ClaimTaskResponseSchema,
  CompleteTaskBodySchema,
  CreateTaskBodySchema,
  FailTaskBodySchema,
  HeartbeatBodySchema,
  HeartbeatResponseSchema,
  ListMessagesQuerySchema,
  ListTaskSchemasResponseSchema,
  ListTasksQuerySchema,
  TaskAttemptParamsSchema,
  TaskListResponseSchema,
  TaskParamsSchema,
  UpdateTaskMetadataBodySchema,
} from '../schemas.js';
import { TaskServiceError } from '../services/task.service.js';
import { authContextToCreator } from '../utils/auth-principal.js';

function toTaskProblem(error: TaskServiceError) {
  switch (error.code) {
    case 'not_found':
      return createProblem('not-found', error.message);
    case 'conflict':
      return createProblem('conflict', error.message);
    case 'forbidden':
      return createProblem('forbidden', error.message);
    case 'unknown_task_type':
    case 'invalid':
      return createValidationProblem(
        error.validationErrors ?? [
          {
            field: error.code === 'unknown_task_type' ? 'taskType' : 'request',
            message: error.message,
          },
        ],
        error.message,
      );
    case 'timed_out':
      return createProblem('conflict', error.message);
  }
}

function getAuthContext(request: {
  authContext: {
    identityId: string;
    subjectType: 'agent' | 'human';
  } | null;
}) {
  const authContext = request.authContext;
  if (!authContext) {
    throw createProblem('unauthorized', 'Authentication context missing');
  }
  return authContext;
}

async function validateAllowedProfiles(
  fastify: FastifyInstance,
  teamId: string,
  allowedProfiles: readonly { profileId: string }[] | undefined,
): Promise<void> {
  const profileIds = [
    ...new Set((allowedProfiles ?? []).map((p) => p.profileId)),
  ];
  for (const profileId of profileIds) {
    const profile = await fastify.daemonProfileRepository.findById(profileId);
    if (!profile || profile.teamId !== teamId) {
      throw createValidationProblem(
        [
          {
            field: 'allowedProfiles',
            message: `Daemon profile ${profileId} does not resolve in team ${teamId}`,
          },
        ],
        'allowedProfiles contains an unknown profile',
      );
    }
  }
}

export function taskRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

  // GET /tasks/schemas
  server.get(
    '/tasks/schemas',
    {
      config: { rateLimit: fastify.rateLimitConfig.read },
      schema: {
        operationId: 'listTaskSchemas',
        tags: ['tasks'],
        description:
          'List built-in task types with their input schemas and CIDs. ' +
          'Consumers (UIs, MCP tools, agents) use this to render forms or ' +
          'validate inputs without hardcoding the registry.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        response: {
          200: Type.Ref(ListTaskSchemasResponseSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    () => {
      const items = Object.entries(BUILT_IN_TASK_TYPES).map(
        ([taskType, entry]) => ({
          taskType,
          outputKind: entry.outputKind,
          inputSchemaCid: TASK_TYPE_SCHEMA_CIDS[taskType] ?? '',
          inputSchema: entry.inputSchema as unknown as Record<string, unknown>,
        }),
      );
      return { items };
    },
  );

  // POST /tasks
  server.post(
    '/tasks',
    {
      schema: {
        operationId: 'createTask',
        tags: ['tasks'],
        description: 'Create and enqueue a new task.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        body: CreateTaskBodySchema,
        response: {
          201: Type.Ref(Task.$id),
          400: Type.Ref(ValidationProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const { identityId, subjectType } = getAuthContext(request);
      const callerNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      try {
        const normalised = normalizeTaskCreateRequest(request.body);
        await validateAllowedProfiles(
          fastify,
          request.body.teamId,
          request.body.allowedProfiles,
        );
        const task = await fastify.taskService.create({
          taskType: request.body.taskType,
          title: request.body.title,
          tags: request.body.tags,
          teamId: request.body.teamId,
          diaryId: request.body.diaryId,
          inputPayload: request.body.input,
          references: request.body.references,
          correlationId: normalised.correlationId,
          claimCondition: request.body.claimCondition,
          maxAttempts: request.body.maxAttempts,
          expiresInSec: request.body.expiresInSec,
          requiredExecutorTrustLevel: request.body.requiredExecutorTrustLevel,
          allowedProfiles: request.body.allowedProfiles,
          dispatchTimeoutSec: request.body.dispatchTimeoutSec,
          runningTimeoutSec: request.body.runningTimeoutSec,
          callerId: identityId,
          callerNs,
          callerIsAgent: subjectType === 'agent',
          // Keto permission checks key on identityId, but the
          // proposedBy*Id columns FK to humans.id / agents.identity_id.
          // authContextToCreator resolves the correct write-side id.
          proposerId: authContextToCreator(request).id,
        });
        return await reply.status(201).send(task);
      } catch (error) {
        if (error instanceof TaskServiceError) throw toTaskProblem(error);
        throw error;
      }
    },
  );

  // GET /tasks
  server.get(
    '/tasks',
    {
      config: { rateLimit: fastify.rateLimitConfig.read },
      schema: {
        operationId: 'listTasks',
        tags: ['tasks'],
        description: 'List tasks for a team with optional filters.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        querystring: ListTasksQuerySchema,
        response: {
          200: Type.Ref(TaskListResponseSchema.$id),
          400: Type.Ref(ValidationProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { identityId, subjectType } = getAuthContext(request);
      const callerNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      try {
        return await fastify.taskService.list({
          teamId: request.query.teamId,
          query: request.query.query,
          status: request.query.status,
          statuses: request.query.statuses,
          taskTypes: request.query.taskTypes,
          tags: request.query.tags,
          excludeTags: request.query.excludeTags,
          profileId: request.query.profileId,
          correlationId: request.query.correlationId,
          diaryId: request.query.diaryId,
          proposedByAgentId: request.query.proposedByAgentId,
          proposedByHumanId: request.query.proposedByHumanId,
          claimedByAgentId: request.query.claimedByAgentId,
          hasAttempts: request.query.hasAttempts,
          queuedAfter: request.query.queuedAfter,
          queuedBefore: request.query.queuedBefore,
          completedAfter: request.query.completedAfter,
          completedBefore: request.query.completedBefore,
          limit: request.query.limit,
          cursor: request.query.cursor,
          callerId: identityId,
          callerNs,
        });
      } catch (error) {
        if (error instanceof TaskServiceError) throw toTaskProblem(error);
        throw error;
      }
    },
  );

  // GET /tasks/:id
  server.get(
    '/tasks/:id',
    {
      config: { rateLimit: fastify.rateLimitConfig.read },
      schema: {
        operationId: 'getTask',
        tags: ['tasks'],
        description: 'Get a task by ID.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: TaskParamsSchema,
        response: {
          200: Type.Ref(Task.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { identityId, subjectType } = getAuthContext(request);
      const callerNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      try {
        return await fastify.taskService.get(
          request.params.id,
          identityId,
          callerNs,
        );
      } catch (error) {
        if (error instanceof TaskServiceError) throw toTaskProblem(error);
        throw error;
      }
    },
  );

  // PATCH /tasks/:id
  server.patch(
    '/tasks/:id',
    {
      schema: {
        operationId: 'updateTaskMetadata',
        tags: ['tasks'],
        description:
          'Update mutable task metadata used for cohorting and search.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: TaskParamsSchema,
        body: UpdateTaskMetadataBodySchema,
        response: {
          200: Type.Ref(Task.$id),
          400: Type.Ref(ValidationProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { identityId, subjectType } = getAuthContext(request);
      const callerNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      try {
        return await fastify.taskService.updateMetadata(request.params.id, {
          ...('title' in request.body ? { title: request.body.title } : {}),
          ...('tags' in request.body ? { tags: request.body.tags } : {}),
          callerId: identityId,
          callerNs,
        });
      } catch (error) {
        if (error instanceof TaskServiceError) throw toTaskProblem(error);
        throw error;
      }
    },
  );

  // POST /tasks/:id/claim
  server.post(
    '/tasks/:id/claim',
    {
      schema: {
        operationId: 'claimTask',
        tags: ['tasks'],
        description: 'Claim a queued task and start an attempt.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: TaskParamsSchema,
        body: ClaimTaskBodySchema,
        response: {
          200: {
            ...Type.Ref(ClaimTaskResponseSchema.$id),
            headers: {
              traceparent: {
                type: 'string',
                description:
                  'W3C trace context header linking worker calls to the workflow trace.',
              },
              tracestate: {
                type: 'string',
                description: 'W3C trace state, present when non-empty.',
              },
            },
          },
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const { identityId, subjectType } = getAuthContext(request);
      const callerNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      try {
        const result = await fastify.taskService.claim(
          request.params.id,
          identityId,
          callerNs,
          request.body.leaseTtlSec,
          {
            executorManifest: request.body.executorManifest,
            executorFingerprint: request.body.executorFingerprint,
            executorSignature: request.body.executorSignature,
          },
        );
        if (typeof request.opentelemetry === 'function') {
          const carrier: Record<string, string> = {};
          request.opentelemetry().inject(carrier);
          if (carrier['traceparent']) {
            reply.header('traceparent', carrier['traceparent']);
            if (carrier['tracestate']) {
              reply.header('tracestate', carrier['tracestate']);
            }
          }
        }
        return await reply.send(result);
      } catch (error) {
        if (error instanceof TaskServiceError) throw toTaskProblem(error);
        throw error;
      }
    },
  );

  // POST /tasks/:id/attempts/:n/heartbeat
  server.post(
    '/tasks/:id/attempts/:n/heartbeat',
    {
      schema: {
        operationId: 'taskHeartbeat',
        tags: ['tasks'],
        description: 'Send a heartbeat to keep the attempt lease alive.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: TaskAttemptParamsSchema,
        body: HeartbeatBodySchema,
        response: {
          200: Type.Ref(HeartbeatResponseSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { identityId, subjectType } = getAuthContext(request);
      const callerNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      try {
        return await fastify.taskService.heartbeat(
          request.params.id,
          request.params.n,
          identityId,
          callerNs,
          request.body.leaseTtlSec,
        );
      } catch (error) {
        if (error instanceof TaskServiceError) throw toTaskProblem(error);
        throw error;
      }
    },
  );

  // POST /tasks/:id/attempts/:n/complete
  server.post(
    '/tasks/:id/attempts/:n/complete',
    {
      schema: {
        operationId: 'completeTask',
        tags: ['tasks'],
        description: 'Mark an attempt as completed with output.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: TaskAttemptParamsSchema,
        body: CompleteTaskBodySchema,
        response: {
          200: Type.Ref(Task.$id),
          400: Type.Ref(ValidationProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { identityId, subjectType } = getAuthContext(request);
      const callerNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      try {
        return await fastify.taskService.complete(
          request.params.id,
          request.params.n,
          identityId,
          callerNs,
          {
            output: request.body.output,
            outputCid: request.body.outputCid,
            usage: request.body.usage,
            contentSignature: request.body.contentSignature,
            executorManifest: request.body.executorManifest,
            executorFingerprint: request.body.executorFingerprint,
            executorSignature: request.body.executorSignature,
            daemonState: request.body.daemonState ?? null,
          },
        );
      } catch (error) {
        if (error instanceof TaskServiceError) throw toTaskProblem(error);
        throw error;
      }
    },
  );

  // POST /tasks/:id/attempts/:n/fail
  server.post(
    '/tasks/:id/attempts/:n/fail',
    {
      schema: {
        operationId: 'failTask',
        tags: ['tasks'],
        description: 'Mark an attempt as failed with error details.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: TaskAttemptParamsSchema,
        body: FailTaskBodySchema,
        response: {
          200: Type.Ref(Task.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { identityId, subjectType } = getAuthContext(request);
      const callerNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      try {
        return await fastify.taskService.fail(
          request.params.id,
          request.params.n,
          identityId,
          callerNs,
          request.body.error,
        );
      } catch (error) {
        if (error instanceof TaskServiceError) throw toTaskProblem(error);
        throw error;
      }
    },
  );

  // POST /tasks/:id/cancel
  server.post(
    '/tasks/:id/cancel',
    {
      schema: {
        operationId: 'cancelTask',
        tags: ['tasks'],
        description: 'Cancel a task.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: TaskParamsSchema,
        body: CancelTaskBodySchema,
        response: {
          200: Type.Ref(Task.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { identityId, subjectType } = getAuthContext(request);
      const callerNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      try {
        return await fastify.taskService.cancel(
          request.params.id,
          identityId,
          callerNs,
          request.body.reason,
          // cancelledBy*Id FKs to humans.id/agents.identity_id, not the
          // Kratos identityId used for the Keto check above.
          authContextToCreator(request).id,
        );
      } catch (error) {
        if (error instanceof TaskServiceError) throw toTaskProblem(error);
        throw error;
      }
    },
  );

  // GET /tasks/:id/attempts
  server.get(
    '/tasks/:id/attempts',
    {
      config: { rateLimit: fastify.rateLimitConfig.read },
      schema: {
        operationId: 'listTaskAttempts',
        tags: ['tasks'],
        description: 'List all attempts for a task.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: TaskParamsSchema,
        response: {
          200: Type.Array(Type.Ref(TaskAttempt.$id)),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { identityId, subjectType } = getAuthContext(request);
      const callerNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      try {
        return await fastify.taskService.listAttempts(
          request.params.id,
          identityId,
          callerNs,
        );
      } catch (error) {
        if (error instanceof TaskServiceError) throw toTaskProblem(error);
        throw error;
      }
    },
  );

  // GET /tasks/:id/attempts/:n/messages
  server.get(
    '/tasks/:id/attempts/:n/messages',
    {
      config: { rateLimit: fastify.rateLimitConfig.read },
      schema: {
        operationId: 'listTaskMessages',
        tags: ['tasks'],
        description: 'List messages for a task attempt.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: TaskAttemptParamsSchema,
        querystring: ListMessagesQuerySchema,
        response: {
          200: Type.Array(Type.Ref(TaskMessage.$id)),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { identityId, subjectType } = getAuthContext(request);
      const callerNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      try {
        return await fastify.taskService.listMessages(
          request.params.id,
          request.params.n,
          identityId,
          callerNs,
          {
            afterSeq: request.query.afterSeq,
            limit: request.query.limit,
          },
        );
      } catch (error) {
        if (error instanceof TaskServiceError) throw toTaskProblem(error);
        throw error;
      }
    },
  );

  // POST /tasks/:id/attempts/:n/messages
  server.post(
    '/tasks/:id/attempts/:n/messages',
    {
      schema: {
        operationId: 'appendTaskMessages',
        tags: ['tasks'],
        description: 'Append messages to a task attempt.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: TaskAttemptParamsSchema,
        body: AppendMessagesBodySchema,
        response: {
          200: Type.Ref(AppendMessagesResponseSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { identityId, subjectType } = getAuthContext(request);
      const callerNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      try {
        return await fastify.taskService.appendMessages(
          request.params.id,
          request.params.n,
          identityId,
          callerNs,
          request.body.messages,
        );
      } catch (error) {
        if (error instanceof TaskServiceError) throw toTaskProblem(error);
        throw error;
      }
    },
  );
}
