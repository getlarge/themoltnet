import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth } from '@moltnet/auth';
import type {
  DaemonRuntimeSlot,
  DaemonRuntimeSlotSession,
  DaemonRuntimeWorkspace,
  ResolvedDaemonRuntimeSlot,
} from '@moltnet/database';
import {
  ConflictProblemDetailsSchema,
  ProblemDetailsSchema,
  ValidationProblemDetailsSchema,
} from '@moltnet/models';
import type { FastifyInstance } from 'fastify';
import { type Static, Type } from 'typebox';

import {
  createConflictProblem,
  createProblem,
  createValidationProblem,
} from '../problems/index.js';
import {
  BeginDaemonRuntimeSlotBodySchema,
  DaemonRuntimeSlotSchema,
  FindDaemonRuntimeProducerSlotQuerySchema,
  FinishDaemonRuntimeSlotBodySchema,
  ResolvedDaemonRuntimeSlotSchema,
} from '../schemas.js';

function authSubject(request: {
  authContext: {
    identityId: string;
    subjectType: 'agent' | 'human';
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

function serializeSlot(slot: DaemonRuntimeSlot) {
  return {
    id: slot.id,
    teamId: slot.teamId,
    daemonId: slot.daemonId,
    agentName: slot.agentName,
    daemonProfileId: slot.daemonProfileId ?? null,
    provider: slot.provider,
    model: slot.model,
    slotKey: slot.slotKey,
    taskType: slot.taskType,
    state: slot.state,
    lastTaskId: slot.lastTaskId,
    lastAttemptN: slot.lastAttemptN,
    workspaceRowId: slot.workspaceRowId ?? null,
    createdAtMs: slot.createdAtMs,
    lastUsedAtMs: slot.lastUsedAtMs,
    expiresAtMs: slot.expiresAtMs,
  };
}

function serializeSession(session: DaemonRuntimeSlotSession | null) {
  if (!session) return null;
  return {
    slotId: session.slotId,
    sessionDir: session.sessionDir,
    sessionPath: session.sessionPath ?? null,
  };
}

function serializeWorkspace(workspace: DaemonRuntimeWorkspace | null) {
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

function serializeResolved(resolved: ResolvedDaemonRuntimeSlot) {
  return {
    session: serializeSession(resolved.session),
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
      'daemon slot task does not resolve in team',
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
      'daemon slot task attempt does not exist',
    );
  }
}

async function assertProfileInTeam(
  fastify: FastifyInstance,
  profileId: string | undefined,
  teamId: string,
) {
  if (!profileId) return;
  const profile = await fastify.daemonProfileRepository.findById(profileId);
  if (!profile || profile.teamId !== teamId) {
    throw createValidationProblem(
      [
        {
          field: 'daemonProfileId',
          message: `Daemon profile ${profileId} does not resolve in team ${teamId}`,
        },
      ],
      'daemon slot profile does not resolve in team',
    );
  }
}

export async function daemonRuntimeSlotRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

  server.post(
    '/daemon-runtime-slots/begin',
    {
      schema: {
        operationId: 'beginDaemonRuntimeSlot',
        tags: ['daemon-runtime-slots'],
        description:
          'Upsert a team-scoped daemon runtime slot for audit and continuation affinity lookup.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        body: Type.Ref(BeginDaemonRuntimeSlotBodySchema.$id),
        response: {
          200: Type.Ref(DaemonRuntimeSlotSchema.$id),
          400: Type.Ref(ValidationProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ConflictProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { identityId, subjectNs, subjectType } = authSubject(request);
      if (subjectType !== 'agent') {
        throw createProblem(
          'forbidden',
          'Daemon slots can only be written by agents',
        );
      }
      const body = request.body as Static<
        typeof BeginDaemonRuntimeSlotBodySchema
      >;
      await requireTeamAccess(fastify, body.teamId, identityId, subjectNs);
      await assertTaskAttemptInTeam(
        fastify,
        body.lastTaskId,
        body.lastAttemptN,
        body.teamId,
      );
      await assertProfileInTeam(fastify, body.daemonProfileId, body.teamId);
      const slot = await fastify.daemonRuntimeSlotRepository.begin({
        ...body,
        daemonProfileId: body.daemonProfileId ?? null,
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
    '/daemon-runtime-slots/finish',
    {
      schema: {
        operationId: 'finishDaemonRuntimeSlot',
        tags: ['daemon-runtime-slots'],
        description:
          'Mark a team-scoped daemon runtime slot idle without deleting it.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        body: Type.Ref(FinishDaemonRuntimeSlotBodySchema.$id),
        response: {
          200: Type.Ref(DaemonRuntimeSlotSchema.$id),
          400: Type.Ref(ValidationProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ConflictProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { identityId, subjectNs, subjectType } = authSubject(request);
      if (subjectType !== 'agent') {
        throw createProblem(
          'forbidden',
          'Daemon slots can only be written by agents',
        );
      }
      const body = request.body as Static<
        typeof FinishDaemonRuntimeSlotBodySchema
      >;
      await requireTeamAccess(fastify, body.teamId, identityId, subjectNs);
      await assertTaskAttemptInTeam(
        fastify,
        body.taskId,
        body.attemptN,
        body.teamId,
      );
      const slot = await fastify.daemonRuntimeSlotRepository.finish({
        ...body,
        sessionPath: body.sessionPath ?? null,
      });
      if (!slot) {
        throw createConflictProblem(
          'Daemon runtime slot changed before finish',
          {
            target: {
              keys: { slotKey: body.slotKey },
              resource: 'daemon-runtime-slot',
            },
          },
        );
      }
      return serializeSlot(slot);
    },
  );

  server.get(
    '/daemon-runtime-slots/producer',
    {
      config: { rateLimit: fastify.rateLimitConfig.read },
      schema: {
        operationId: 'findDaemonRuntimeProducerSlot',
        tags: ['daemon-runtime-slots'],
        description:
          'Find the latest team-scoped producer slot for a task attempt.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        querystring: Type.Ref(FindDaemonRuntimeProducerSlotQuerySchema.$id),
        response: {
          200: Type.Ref(ResolvedDaemonRuntimeSlotSchema.$id),
          400: Type.Ref(ValidationProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { identityId, subjectNs } = authSubject(request);
      const { teamId, taskId, attemptN } = request.query as Static<
        typeof FindDaemonRuntimeProducerSlotQuerySchema
      >;
      await requireTeamAccess(fastify, teamId, identityId, subjectNs);
      await assertTaskAttemptInTeam(fastify, taskId, attemptN, teamId);
      const resolved =
        await fastify.daemonRuntimeSlotRepository.findLatestProducerByTaskAttempt(
          teamId,
          taskId,
          attemptN,
        );
      if (!resolved) throw createProblem('not-found');
      return serializeResolved(resolved);
    },
  );
}
