import { createHash, randomUUID } from 'node:crypto';

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth } from '@moltnet/auth';
import type {
  TaskActivityAnalyticsResult,
  TaskActivityMetricBucket,
} from '@moltnet/database';
import { DBOSErrors } from '@moltnet/database';
import {
  ConflictProblemDetailsSchema,
  ProblemDetailsSchema,
  TeamHeaderRequiredSchema,
  ValidationProblemDetailsSchema,
} from '@moltnet/models';
import { TaskAnalyticsServiceError } from '@moltnet/task-analytics-service';
import {
  BUILT_IN_TASK_TYPES,
  normalizeTaskCreateRequest,
  Task,
  TASK_TYPE_SCHEMA_CIDS,
  TaskAttempt,
  TaskMessage,
} from '@moltnet/tasks';
import { CredentialError } from '@themoltnet/credentials';
import type { FastifyInstance } from 'fastify';
import { type Static, Type } from 'typebox';

import {
  createConflictProblem,
  createProblem,
  createValidationProblem,
} from '../problems/index.js';
import {
  AbortTaskBodySchema,
  AppendMessagesBodySchema,
  AppendMessagesResponseSchema,
  BatchDeleteTasksAcceptedResponseSchema,
  BatchDeleteTasksBodySchema,
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
  RegisterExecutorManifestBodySchema,
  RegisterExecutorManifestResponseSchema,
  TaskActivityAnalyticsQuerySchema,
  TaskActivityAnalyticsResponseSchema,
  TaskAttemptParamsSchema,
  TaskCredentialResponseSchema,
  TaskListResponseSchema,
  TaskParamsSchema,
  UpdateTaskMetadataBodySchema,
} from '../schemas.js';
import { TaskServiceError } from '../services/task.service.js';
import { authContextToCreator } from '../utils/auth-principal.js';
import { requireCurrentTeamId } from '../utils/require-current-team-id.js';
import { requireKetoSubject } from '../utils/require-keto-subject.js';
import { startTaskDeletionWorkflow } from '../workflows/index.js';

type BatchDeleteTasksBody = Static<typeof BatchDeleteTasksBodySchema>;

function taskDeletionDeduplicationId(ids: string[], force: boolean): string {
  const payload = JSON.stringify({ force, ids: [...ids].sort() });
  const digest = createHash('sha256').update(payload).digest('hex');
  return `task-delete:${digest}`;
}

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
    case 'unavailable':
      return createProblem('service-unavailable', error.message);
  }
}

/** Extract the raw bearer credential, or null when the caller used another scheme. */
function bearerCredential(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const [scheme, ...rest] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer') return null;
  const credential = rest.join(' ').trim();
  return credential.length > 0 ? credential : null;
}

/**
 * Map a broker failure onto a problem response.
 *
 * The broker's codes are the stable contract. The split that matters here: an
 * authorization denial (`authority_denied`) must never be reported the same way
 * as a signing or evidence outage, so a dependency failure alerts separately
 * from an agent asking for something it cannot have.
 */
function toCredentialProblem(error: unknown) {
  if (!(error instanceof CredentialError)) return error;
  switch (error.code) {
    case 'authority_denied':
    case 'derivation_rejected':
      return createProblem(
        'forbidden',
        'Task credential authority was denied for this attempt',
      );
    case 'ttl_exhausted':
      return createConflictProblem(
        'The attempt lease has too little time remaining to issue a task credential',
      );
    case 'authority_unavailable':
    case 'derivation_unavailable':
    case 'evidence_unavailable':
    case 'credential_verification_unavailable':
      return createProblem(
        'service-unavailable',
        'Task credential issuance is temporarily unavailable',
      );
    default:
      return createProblem(
        'internal-server-error',
        'Task credential issuance failed',
      );
  }
}

function toTaskAnalyticsProblem(error: TaskAnalyticsServiceError) {
  switch (error.code) {
    case 'forbidden':
      return createProblem('forbidden', error.message);
    case 'invalid':
      return createValidationProblem(
        error.validationErrors ?? [
          {
            field: 'request',
            message: error.message,
          },
        ],
        error.message,
      );
  }
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function nullableRatio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function toProductMetrics(
  metrics: TaskActivityMetricBucket,
  rangeDays: number,
) {
  return {
    hurdles: {
      abortedAttemptCount: metrics.abortedAttemptCount,
      cancelledAttemptCount: metrics.cancelledAttemptCount,
      failedAttemptCount: metrics.failedAttemptCount,
      failedToolCallCount: metrics.failedToolCallCount,
      failedToolCallRate: rate(
        metrics.failedToolCallCount,
        metrics.toolCallCount,
      ),
      highFrictionAttemptCount: metrics.highFrictionAttemptCount,
      retryAttemptCount: metrics.retryAttemptCount,
      timeoutAttemptCount: metrics.timeoutAttemptCount,
    },
    knowledge: {
      entryGetCount: metrics.entryGetCount,
      entrySearchCount: metrics.entrySearchCount,
      knowledgeCallsPerAcceptedTask: nullableRatio(
        metrics.knowledgeToolCallCount,
        metrics.acceptedTaskCount,
      ),
      knowledgeToolCallCount: metrics.knowledgeToolCallCount,
      packGetCount: metrics.packGetCount,
    },
    productivity: {
      acceptedTasksPerDay:
        rangeDays > 0 ? metrics.acceptedTaskCount / rangeDays : 0,
      attemptCount: metrics.attemptCount,
      averageAttemptsPerAcceptedTask: nullableRatio(
        metrics.attemptCount,
        metrics.acceptedTaskCount,
      ),
      medianTimeToAcceptedMs: metrics.medianTimeToAcceptedMs,
      medianToolCallsPerAttempt: metrics.medianToolCallsPerAttempt,
      medianTurnsPerAttempt: metrics.medianTurnsPerAttempt,
    },
    raw: {
      failedToolCallCount: metrics.failedToolCallCount,
      messageCount: metrics.messageCount,
      toolCallCount: metrics.toolCallCount,
      turnCount: metrics.turnCount,
    },
    roi: {
      acceptedTasksPerThousandTokens:
        metrics.totalTokens > 0
          ? (metrics.acceptedTaskCount / metrics.totalTokens) * 1000
          : null,
      extraAttemptCount: metrics.extraAttemptCount,
      extraTokensBeforeAcceptance: metrics.extraTokensBeforeAcceptance,
      tokensPerAcceptedTask: nullableRatio(
        metrics.totalTokens,
        metrics.acceptedTaskCount,
      ),
      totalInputTokens: metrics.totalInputTokens,
      totalOutputTokens: metrics.totalOutputTokens,
      totalTokens: metrics.totalTokens,
    },
    success: {
      acceptedOutputRate: rate(metrics.acceptedTaskCount, metrics.taskCount),
      acceptedTaskCount: metrics.acceptedTaskCount,
      firstAttemptAcceptedRate: rate(
        metrics.firstAttemptAcceptedTaskCount,
        metrics.taskCount,
      ),
      firstAttemptAcceptedTaskCount: metrics.firstAttemptAcceptedTaskCount,
      retryRecoveredTaskCount: metrics.retryRecoveredTaskCount,
      retryRecoveryRate: rate(
        metrics.retryRecoveredTaskCount,
        metrics.acceptedTaskCount,
      ),
      taskCount: metrics.taskCount,
      terminalFailureRate: rate(
        metrics.terminalFailureTaskCount,
        metrics.taskCount,
      ),
      terminalFailureTaskCount: metrics.terminalFailureTaskCount,
    },
  };
}

function toAnalyticsResponse(input: {
  completedAfter: Date;
  completedBefore: Date;
  result: TaskActivityAnalyticsResult;
}) {
  const rangeMs =
    input.completedBefore.getTime() - input.completedAfter.getTime();
  const rangeDays = Math.max(1, rangeMs / (24 * 60 * 60 * 1000));
  return {
    groups: input.result.groups.map((group) => ({
      key: group.key,
      label: group.label,
      metrics: toProductMetrics(group.metrics, rangeDays),
    })),
    overall: toProductMetrics(input.result.overall, rangeDays),
    range: {
      completedAfter: input.completedAfter.toISOString(),
      completedBefore: input.completedBefore.toISOString(),
    },
    statsComplete: input.result.statsComplete,
  };
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
    const profile = await fastify.runtimeProfileRepository.findById(profileId);
    if (!profile || profile.teamId !== teamId) {
      throw createValidationProblem(
        [
          {
            field: 'allowedProfiles',
            message: `Runtime profile ${profileId} does not resolve in team ${teamId}`,
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

  // Enforce the agent-key team ceiling at the resource boundary. A team-bound
  // key resolves its bound team as the request ceiling, but a task addressed by
  // id could still belong to a *different* team the same agent can otherwise
  // access — the by-id lifecycle routes authorize by identity + per-task Keto,
  // not by the resolved team. Reject when the addressed task is outside the
  // key's bound team so the "immutable team ceiling" holds for task execution.
  // Only team-bound agent credentials are constrained; OAuth2 agents and humans
  // have no binding, skip immediately, and keep their existing authorization.
  server.addHook('preHandler', async (request) => {
    const authContext = request.authContext;
    if (authContext?.subjectType !== 'agent') return;
    const boundTeamId = authContext.credentialBinding?.boundTeamId;
    if (!boundTeamId) return;
    const taskId = (request.params as { id?: string } | undefined)?.id;
    if (!taskId) return;
    // `get` is a read (canViewTask + findById); a claimant can always view, so
    // this never rejects a legitimate operation — it only trips the ceiling.
    const task = await fastify.taskService.get(
      taskId,
      authContext.identityId,
      KetoNamespace.Agent,
    );
    if (task.teamId !== boundTeamId) {
      throw createProblem(
        'forbidden',
        'Agent key is bound to a different team than the addressed task',
      );
    }
  });

  // #1776 phase 0 — measure before enforcing.
  //
  // Attenuation only buys anything once broad agent-key authority is *refused*
  // on task-scoped routes. Until then, count the calls that a task credential
  // could have carried instead: an agent-key request on an attempt-scoped route
  // for a profile-backed attempt. The label is the route template only, so
  // cardinality stays flat. Telemetry never fails a request.
  server.addHook('preHandler', async (request) => {
    try {
      const authContext = request.authContext;
      if (authContext?.subjectType !== 'agent') return;
      if (!authContext.credentialBinding) return;
      const route = request.routeOptions.url;
      if (
        !route?.startsWith('/tasks/:id/attempts/:n/') ||
        // Minting is itself an agent-key call by design — it is the exchange.
        route.endsWith('/credentials')
      ) {
        return;
      }
      const params = request.params as { id?: string; n?: number } | undefined;
      if (!params?.id || typeof params.n !== 'number') return;
      const attempt = await fastify.taskRepository.findAttempt(
        params.id,
        params.n,
      );
      // Legacy/all-null attempts can never obtain a credential, so they are not
      // part of the population the cut-over applies to.
      if (!attempt?.leaseId || !attempt.runtimeProfileId) return;
      fastify.taskCredentials.agentKeyFallbackCounter.add(1, { route });
    } catch (err) {
      request.log.debug(
        { err },
        'credential.task_route_agent_key_telemetry_failed',
      );
    }
  });

  // GET /tasks/schemas
  server.get(
    '/tasks/schemas',
    {
      config: {
        auth: { credentialBindingScope: 'identity' },
        rateLimit: fastify.rateLimitConfig.read,
      },
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
      config: { auth: { credentialBindingScope: 'team' } },
      schema: {
        operationId: 'createTask',
        tags: ['tasks'],
        description: 'Create and enqueue a new task.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        body: CreateTaskBodySchema,
        response: {
          201: Type.Ref(Task.$id),
          400: Type.Ref(ValidationProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ConflictProblemDetailsSchema.$id),
          503: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const {
        identityId,
        subjectNs: callerNs,
        subjectType,
      } = requireKetoSubject(request);
      const teamId = requireCurrentTeamId(request, 'tasks');
      try {
        const normalised = normalizeTaskCreateRequest(request.body);
        await validateAllowedProfiles(
          fastify,
          teamId,
          request.body.allowedProfiles,
        );
        const task = await fastify.taskService.create({
          taskType: request.body.taskType,
          title: request.body.title,
          tags: request.body.tags,
          teamId,
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
      config: {
        auth: { credentialBindingScope: 'team' },
        rateLimit: fastify.rateLimitConfig.read,
      },
      schema: {
        operationId: 'listTasks',
        tags: ['tasks'],
        description: 'List tasks for a team with optional filters.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
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
      const { identityId, subjectNs: callerNs } = requireKetoSubject(request);
      const teamId = requireCurrentTeamId(request, 'tasks');
      try {
        return await fastify.taskService.list({
          teamId,
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

  // DELETE /tasks
  server.delete<{ Body: BatchDeleteTasksBody }>(
    '/tasks',
    {
      schema: {
        operationId: 'batchDeleteTasks',
        tags: ['tasks'],
        description:
          'Queue asynchronous deletion of waiting, queued, and terminal tasks in bulk. By default, dispatched, running, unauthorized, missing, and protected tasks are skipped. Set force: true with a reason to delete protected terminal tasks.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        body: BatchDeleteTasksBodySchema,
        response: {
          202: Type.Ref(BatchDeleteTasksAcceptedResponseSchema.$id),
          400: Type.Ref(ValidationProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          500: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const {
        identityId,
        subjectNs: callerNs,
        subjectType,
      } = requireKetoSubject(request);
      try {
        const force = request.body.force ?? false;
        const plan = await fastify.taskService.planDeleteMany({
          ids: request.body.ids,
          callerId: identityId,
          callerNs,
          force,
          reason: request.body.reason,
        });
        const operationId = taskDeletionDeduplicationId(
          plan.accepted.length === 0 ? request.body.ids : plan.accepted,
          force,
        );
        request.log.info(
          {
            operationId,
            requestedTaskIds: request.body.ids,
            acceptedTaskIds: plan.accepted,
            skippedTaskIds: plan.skipped,
            requested: request.body.ids.length,
            accepted: plan.accepted.length,
            skipped: plan.skipped.length,
            force,
            requestedBy: { id: identityId, ns: subjectType },
          },
          'task.delete.plan',
        );
        if (plan.accepted.length === 0) {
          request.log.info(
            {
              operationId,
              requestedTaskIds: request.body.ids,
              skippedTaskIds: plan.skipped,
              requested: request.body.ids.length,
              skipped: plan.skipped.length,
              force,
              requestedBy: { id: identityId, ns: subjectType },
            },
            'task.delete.noop',
          );
          return await reply.status(202).send({
            workflowId: null,
            operationId,
            status: 'noop',
            accepted: [],
            skipped: plan.skipped,
          });
        }
        let workflowId: string | null = null;
        let status: 'queued' | 'duplicate' = 'queued';
        try {
          const handle = await startTaskDeletionWorkflow(
            {
              ids: plan.accepted,
              force,
              operationId,
              reason: request.body.reason,
              requestedBy: {
                id: identityId,
                ns: subjectType,
              },
            },
            `task-delete:${randomUUID()}`,
            operationId,
          );
          workflowId = handle.workflowID;
          request.log.info(
            {
              workflowId,
              operationId,
              acceptedTaskIds: plan.accepted,
              skippedTaskIds: plan.skipped,
              accepted: plan.accepted.length,
              skipped: plan.skipped.length,
              force,
              requestedBy: { id: identityId, ns: subjectType },
            },
            'task.delete.workflow_queued',
          );
        } catch (error) {
          if (!(error instanceof DBOSErrors.DBOSQueueDuplicatedError)) {
            request.log.error(
              {
                err: error,
                operationId,
                acceptedTaskIds: plan.accepted,
                skippedTaskIds: plan.skipped,
                accepted: plan.accepted.length,
                skipped: plan.skipped.length,
                force,
                requestedBy: { id: identityId, ns: subjectType },
              },
              'task.delete.workflow_enqueue_failed',
            );
            throw error;
          }
          status = 'duplicate';
          request.log.info(
            {
              err: error,
              operationId,
              acceptedTaskIds: plan.accepted,
              skippedTaskIds: plan.skipped,
              accepted: plan.accepted.length,
              skipped: plan.skipped.length,
              force,
              requestedBy: { id: identityId, ns: subjectType },
            },
            'task.delete.workflow_duplicate',
          );
        }

        return await reply.status(202).send({
          workflowId,
          operationId,
          status,
          accepted: plan.accepted,
          skipped: plan.skipped,
        });
      } catch (error) {
        if (error instanceof TaskServiceError) throw toTaskProblem(error);
        throw error;
      }
    },
  );

  // GET /tasks/analytics/activity
  server.get(
    '/tasks/analytics/activity',
    {
      config: {
        auth: { credentialBindingScope: 'team' },
        rateLimit: fastify.rateLimitConfig.read,
      },
      schema: {
        operationId: 'getTaskActivityAnalytics',
        tags: ['tasks'],
        description:
          'Return bounded product analytics for task attempts: success, productivity, hurdles, knowledge leverage, and token-efficiency ROI proxies.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        querystring: TaskActivityAnalyticsQuerySchema,
        response: {
          200: Type.Ref(TaskActivityAnalyticsResponseSchema.$id),
          400: Type.Ref(ValidationProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { identityId, subjectNs: callerNs } = requireKetoSubject(request);
      const teamId = requireCurrentTeamId(request, 'task analytics');
      const completedBefore = request.query.completedBefore
        ? new Date(request.query.completedBefore)
        : new Date();
      const completedAfter = request.query.completedAfter
        ? new Date(request.query.completedAfter)
        : new Date(completedBefore.getTime() - 30 * 24 * 60 * 60 * 1000);
      try {
        const result = await fastify.taskAnalyticsService.getActivityAnalytics({
          claimedByAgentIds: request.query.claimedByAgentIds,
          completedAfter: completedAfter.toISOString(),
          completedBefore: completedBefore.toISOString(),
          diaryIds: request.query.diaryIds,
          groupBy: request.query.groupBy ?? 'none',
          profileIds: request.query.profileIds,
          tags: request.query.tags,
          taskTypes: request.query.taskTypes,
          teamId,
          callerId: identityId,
          callerNs,
        });
        return toAnalyticsResponse({ completedAfter, completedBefore, result });
      } catch (error) {
        if (error instanceof TaskAnalyticsServiceError) {
          throw toTaskAnalyticsProblem(error);
        }
        throw error;
      }
    },
  );

  // GET /tasks/:id
  server.get(
    '/tasks/:id',
    {
      config: {
        rateLimit: fastify.rateLimitConfig.read,
        auth: { credentialBindingScope: 'team' },
      },
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
      const { identityId, subjectNs: callerNs } = requireKetoSubject(request);
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
      const { identityId, subjectNs: callerNs } = requireKetoSubject(request);
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

  // POST /executor-manifests/register
  server.post(
    '/executor-manifests/register',
    {
      config: { auth: { credentialBindingScope: 'identity' } },
      schema: {
        operationId: 'registerExecutorManifest',
        tags: ['tasks'],
        description:
          'Register an agent-signed executor manifest for fingerprint-only task claims.',
        security: [{ bearerAuth: [] }],
        body: RegisterExecutorManifestBodySchema,
        response: {
          200: RegisterExecutorManifestResponseSchema,
          400: Type.Ref(ValidationProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ConflictProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { identityId, subjectNs: callerNs } = requireKetoSubject(request);
      try {
        return await fastify.taskService.registerExecutorManifest(
          identityId,
          callerNs,
          request.body,
        );
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
      config: { auth: { credentialBindingScope: 'team' } },
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
          409: Type.Ref(ConflictProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const { identityId, subjectNs: callerNs } = requireKetoSubject(request);
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
            profileId: request.body.profileId,
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

  // POST /tasks/:id/attempts/:n/credentials
  server.post(
    '/tasks/:id/attempts/:n/credentials',
    {
      config: { auth: { credentialBindingScope: 'team' } },
      schema: {
        operationId: 'issueTaskCredential',
        tags: ['tasks'],
        description:
          "Exchange the claimant's team-bound agent key for a short-lived, " +
          'lease-bound task credential. The request carries no authority ' +
          'inputs: MoltNet rebuilds the claim-time authority tuple, mints the ' +
          'canonical claims itself, and bounds the lifetime to ' +
          '`min(configured ceiling, remaining lease)`. The credential is ' +
          'memory-only — never log it, persist it, or expose it to a model.',
        security: [{ bearerAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        params: TaskAttemptParamsSchema,
        // No `body` schema: the endpoint takes no input at all, so the contract
        // (and every generated client) says so, and a caller may send no body.
        // The preValidation guard below rejects one that carries fields.
        response: {
          200: Type.Ref(TaskCredentialResponseSchema.$id),
          400: Type.Ref(ValidationProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ConflictProblemDetailsSchema.$id),
          500: Type.Ref(ProblemDetailsSchema.$id),
          503: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
      // Reject rather than ignore a smuggled field: the app-wide ajv
      // `removeAdditional` would strip it silently, leaving a caller believing
      // its `ttl` or `scopes` was honored. preValidation runs after body parsing
      // and before schema validation, so this sees exactly what was sent.
      preValidation: async (request) => {
        const body = request.body;
        if (body === undefined || body === null) return;
        if (
          typeof body !== 'object' ||
          Array.isArray(body) ||
          Object.keys(body).length > 0
        ) {
          throw createValidationProblem(
            [
              {
                field: 'body',
                message:
                  'Task credential issuance accepts no request fields. Scopes, claims, TTL, audience, algorithm, and endpoints are server-owned.',
              },
            ],
            'Task credential requests must have an empty body',
          );
        }
      },
    },
    async (request) => {
      const authContext = request.authContext;
      if (authContext?.subjectType !== 'agent') {
        throw createProblem(
          'forbidden',
          'Task credentials are issued to the claimant agent only',
        );
      }
      const agentCredential = bearerCredential(request.headers.authorization);
      if (!agentCredential) {
        throw createProblem(
          'forbidden',
          'Task credential issuance requires the claimant agent credential as a bearer token',
        );
      }
      // The caller's asserted team is the ceiling being checked, so it must come
      // from the auth context — never from the addressed task, which would make
      // the team check vacuous.
      const teamId = requireCurrentTeamId(request, 'task credentials');
      try {
        const issued = await fastify.taskCredentials.broker.issueTaskCredential(
          {
            agentId: authContext.identityId,
            teamId,
            taskId: request.params.id,
            attemptN: request.params.n,
            agentCredential,
          },
        );
        // The body carries a bearer credential, so it must never be cached.
        // The security-headers plugin already sends
        // `Cache-Control: no-store, no-cache, must-revalidate` on every
        // authenticated response; task-credentials.test.ts asserts it holds here.
        return {
          token: issued.token,
          tokenType: 'Bearer' as const,
          expiresAt: issued.expiresAt.toISOString(),
          issuer: fastify.taskCredentials.issuer,
          audience: fastify.taskCredentials.audience,
          jwksUri: fastify.taskCredentials.jwksUri,
          claims: issued.claims,
        };
      } catch (error) {
        throw toCredentialProblem(error);
      }
    },
  );

  // POST /tasks/:id/attempts/:n/heartbeat
  server.post(
    '/tasks/:id/attempts/:n/heartbeat',
    {
      config: { auth: { credentialBindingScope: 'team' } },
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
      const { identityId, subjectNs: callerNs } = requireKetoSubject(request);
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
      config: { auth: { credentialBindingScope: 'team' } },
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
          409: Type.Ref(ConflictProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { identityId, subjectNs: callerNs } = requireKetoSubject(request);
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
      config: { auth: { credentialBindingScope: 'team' } },
      schema: {
        operationId: 'failTaskAttempt',
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
          409: Type.Ref(ConflictProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { identityId, subjectNs: callerNs } = requireKetoSubject(request);
      try {
        return await fastify.taskService.failAttempt(
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

  // POST /tasks/:id/attempts/:n/abort
  server.post(
    '/tasks/:id/attempts/:n/abort',
    {
      config: { auth: { credentialBindingScope: 'team' } },
      schema: {
        operationId: 'abortTaskAttempt',
        tags: ['tasks'],
        description:
          'Claimant intentionally abandons this attempt (e.g. daemon shutdown). ' +
          'The attempt becomes aborted and the task requeues for another claim ' +
          '(or fails when retries are exhausted). Does NOT cancel the task.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: TaskAttemptParamsSchema,
        body: AbortTaskBodySchema,
        response: {
          200: Type.Ref(Task.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ConflictProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { identityId, subjectNs: callerNs } = requireKetoSubject(request);
      try {
        return await fastify.taskService.abort(
          request.params.id,
          request.params.n,
          identityId,
          callerNs,
          request.body.reason,
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
          409: Type.Ref(ConflictProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { identityId, subjectNs: callerNs } = requireKetoSubject(request);
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
      config: {
        rateLimit: fastify.rateLimitConfig.read,
        auth: { credentialBindingScope: 'team' },
      },
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
      const { identityId, subjectNs: callerNs } = requireKetoSubject(request);
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
      config: {
        rateLimit: fastify.rateLimitConfig.read,
        auth: { credentialBindingScope: 'team' },
      },
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
      const { identityId, subjectNs: callerNs } = requireKetoSubject(request);
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
      config: { auth: { credentialBindingScope: 'team' } },
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
      const { identityId, subjectNs: callerNs } = requireKetoSubject(request);
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
