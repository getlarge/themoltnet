import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth } from '@moltnet/auth';
import type {
  ResolvedRuntimeSlot,
  RuntimeSlot,
  RuntimeWorkspace,
} from '@moltnet/database';
import {
  ConflictProblemDetailsSchema,
  ProblemDetailsSchema,
  TeamHeaderRequiredSchema,
  ValidationProblemDetailsSchema,
} from '@moltnet/models';
import {
  BeginRuntimeSlotBody as BeginRuntimeSlotBodySchema,
  FindLatestRuntimeSlotForAttemptQuery as FindLatestRuntimeSlotForAttemptQuerySchema,
  FinishRuntimeSlotBody as FinishRuntimeSlotBodySchema,
  ResolvedRuntimeSlot as ResolvedRuntimeSlotSchema,
  RuntimeSlot as RuntimeSlotSchema,
} from '@moltnet/tasks';
import type { FastifyInstance } from 'fastify';

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

function serializeSlot(slot: RuntimeSlot) {
  return {
    id: slot.id,
    teamId: slot.teamId,
    agentName: slot.agentName,
    runtimeProfileId: slot.runtimeProfileId ?? null,
    provider: slot.provider,
    model: slot.model,
    slotKey: slot.slotKey,
    taskType: slot.taskType,
    state: slot.state,
    lastTaskId: slot.lastTaskId,
    lastAttemptN: slot.lastAttemptN,
    sessionDir: slot.sessionDir ?? null,
    sessionPath: slot.sessionPath ?? null,
    workspaceRowId: slot.workspaceRowId ?? null,
    createdAtMs: slot.createdAtMs,
    lastUsedAtMs: slot.lastUsedAtMs,
    expiresAtMs: slot.expiresAtMs,
  };
}

function serializeWorkspace(workspace: RuntimeWorkspace | null) {
  if (!workspace) return null;
  return {
    id: workspace.id,
    teamId: workspace.teamId,
    workspaceId: workspace.workspaceId,
    worktreePath: workspace.worktreePath,
    worktreeBranch: workspace.worktreeBranch ?? null,
    kind: workspace.kind,
    createdAtMs: workspace.createdAtMs,
    lastUsedAtMs: workspace.lastUsedAtMs,
  };
}

function serializeResolved(resolved: ResolvedRuntimeSlot) {
  return {
    slot: serializeSlot(resolved.slot),
    workspace: serializeWorkspace(resolved.workspace),
  };
}

async function requireTeamAccess(
  fastify: FastifyInstance,
  teamId: string,
  identityId: string,
  subjectNs: KetoNamespace,
) {
  const canAccess = await fastify.permissionChecker.canAccessTeam(
    teamId,
    identityId,
    subjectNs,
  );
  if (!canAccess) throw createProblem('not-found');
}

async function assertTaskInTeam(
  fastify: FastifyInstance,
  taskId: string,
  teamId: string,
) {
  const task = await fastify.taskRepository.findById(taskId);
  if (!task || task.teamId !== teamId) {
    throw createValidationProblem(
      [
        {
          field: 'taskId',
          message: `Task ${taskId} does not resolve in team ${teamId}`,
        },
      ],
      'runtime slot task does not resolve in team',
    );
  }
}

async function assertTaskAttemptInTeam(
  fastify: FastifyInstance,
  taskId: string,
  attemptN: number,
  teamId: string,
) {
  await assertTaskInTeam(fastify, taskId, teamId);
  const attempt = await fastify.taskRepository.findAttempt(taskId, attemptN);
  if (!attempt) {
    throw createValidationProblem(
      [
        {
          field: 'attemptN',
          message: `Task ${taskId} attempt ${attemptN} does not exist`,
        },
      ],
      'runtime slot task attempt does not exist',
    );
  }
}

async function assertProfileInTeam(
  fastify: FastifyInstance,
  profileId: string,
  teamId: string,
) {
  const profile = await fastify.runtimeProfileRepository.findById(profileId);
  if (!profile || profile.teamId !== teamId) {
    throw createValidationProblem(
      [
        {
          field: 'runtimeProfileId',
          message: `Runtime profile ${profileId} does not resolve in team ${teamId}`,
        },
      ],
      'runtime slot profile does not resolve in team',
    );
  }
}

export async function runtimeSlotRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

  server.post(
    '/runtime-slots/begin',
    {
      schema: {
        operationId: 'beginRuntimeSlot',
        tags: ['runtime-slots'],
        description:
          'Upsert a team-scoped runtime slot for audit and continuation affinity lookup.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        body: BeginRuntimeSlotBodySchema,
        response: {
          200: RuntimeSlotSchema,
          400: ValidationProblemDetailsSchema,
          401: ProblemDetailsSchema,
          403: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
          409: ConflictProblemDetailsSchema,
        },
      },
    },
    async (request) => {
      const { identityId, subjectNs, subjectType } = authSubject(request);
      if (subjectType !== 'agent') {
        throw createProblem(
          'forbidden',
          'Runtime slots can only be written by agents',
        );
      }
      const body = request.body;
      const teamId = requireCurrentTeamId(request, 'runtime slots');
      await requireTeamAccess(fastify, teamId, identityId, subjectNs);
      await assertTaskAttemptInTeam(
        fastify,
        body.lastTaskId,
        body.lastAttemptN,
        teamId,
      );
      await assertProfileInTeam(fastify, body.runtimeProfileId, teamId);
      const slot = await fastify.runtimeSlotRepository.begin({
        ...body,
        teamId,
        sessionDir: body.sessionDir ?? null,
        sessionPath: body.sessionPath ?? null,
        workspaceId: body.workspaceId ?? null,
        worktreeBranch: body.worktreeBranch ?? null,
        worktreePath: body.worktreePath ?? null,
      });
      return serializeSlot(slot);
    },
  );

  server.post(
    '/runtime-slots/finish',
    {
      schema: {
        operationId: 'finishRuntimeSlot',
        tags: ['runtime-slots'],
        description:
          'Mark a team-scoped runtime slot idle without deleting it.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        body: FinishRuntimeSlotBodySchema,
        response: {
          200: RuntimeSlotSchema,
          400: ValidationProblemDetailsSchema,
          401: ProblemDetailsSchema,
          403: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
          409: ConflictProblemDetailsSchema,
        },
      },
    },
    async (request) => {
      const { identityId, subjectNs, subjectType } = authSubject(request);
      if (subjectType !== 'agent') {
        throw createProblem(
          'forbidden',
          'Runtime slots can only be written by agents',
        );
      }
      const body = request.body;
      const teamId = requireCurrentTeamId(request, 'runtime slots');
      await requireTeamAccess(fastify, teamId, identityId, subjectNs);
      await assertTaskAttemptInTeam(
        fastify,
        body.taskId,
        body.attemptN,
        teamId,
      );
      await assertProfileInTeam(fastify, body.runtimeProfileId, teamId);
      const slot = await fastify.runtimeSlotRepository.finish({
        ...body,
        teamId,
        sessionPath: body.sessionPath ?? null,
      });
      if (!slot) {
        throw createConflictProblem('Runtime slot changed before finish', {
          target: {
            keys: { slotKey: body.slotKey },
            resource: 'runtime-slot',
          },
        });
      }
      return serializeSlot(slot);
    },
  );

  server.get(
    '/runtime-slots/latest',
    {
      config: { rateLimit: fastify.rateLimitConfig.read },
      schema: {
        operationId: 'findLatestRuntimeSlotForAttempt',
        tags: ['runtime-slots'],
        description:
          'Find the latest team-scoped runtime slot for a task attempt.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        querystring: FindLatestRuntimeSlotForAttemptQuerySchema,
        response: {
          200: ResolvedRuntimeSlotSchema,
          400: ValidationProblemDetailsSchema,
          401: ProblemDetailsSchema,
          403: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
        },
      },
    },
    async (request) => {
      const { identityId, subjectNs } = authSubject(request);
      const teamId = requireCurrentTeamId(request, 'runtime slots');
      const { taskId, attemptN } = request.query;
      await requireTeamAccess(fastify, teamId, identityId, subjectNs);
      await assertTaskAttemptInTeam(fastify, taskId, attemptN, teamId);
      const resolved =
        await fastify.runtimeSlotRepository.findLatestByTaskAttempt(
          teamId,
          taskId,
          attemptN,
        );
      if (!resolved) throw createProblem('not-found');
      return serializeResolved(resolved);
    },
  );
}
