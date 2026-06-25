import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth } from '@moltnet/auth';
import type { RuntimeSession } from '@moltnet/database';
import {
  ProblemDetailsSchema,
  TeamHeaderRequiredSchema,
  ValidationProblemDetailsSchema,
} from '@moltnet/models';
import {
  DownloadRuntimeSessionResponse as DownloadRuntimeSessionResponseSchema,
  RuntimeSession as RuntimeSessionSchema,
  RuntimeSessionAttemptParams as RuntimeSessionAttemptParamsSchema,
  UploadRuntimeSessionBody as UploadRuntimeSessionBodySchema,
} from '@moltnet/tasks';
import type { FastifyInstance } from 'fastify';

import { createProblem, createValidationProblem } from '../problems/index.js';
import {
  MissingRuntimeSessionObjectError,
  RuntimeSessionStorageNotConfiguredError,
} from '../services/runtime-session-storage.js';
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

function serializeSession(session: RuntimeSession) {
  return {
    id: session.id,
    teamId: session.teamId,
    taskId: session.taskId,
    attemptN: session.attemptN,
    sourceSlotId: session.sourceSlotId ?? null,
    sourceRuntimeProfileId: session.sourceRuntimeProfileId ?? null,
    sessionKind: session.sessionKind,
    parentSessionId: session.parentSessionId ?? null,
    objectKey: session.objectKey,
    contentType: session.contentType,
    contentEncoding: session.contentEncoding ?? null,
    sizeBytes: session.sizeBytes,
    sha256: session.sha256,
    storageClass: session.storageClass,
    checkpointKind: session.checkpointKind,
    uploadedAt: session.uploadedAt.toISOString(),
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

async function requireTaskReadAccess(
  fastify: FastifyInstance,
  taskId: string,
  identityId: string,
  subjectNs: KetoNamespace,
) {
  const canView = await fastify.permissionChecker.canViewTask(
    taskId,
    identityId,
    subjectNs,
  );
  if (!canView) throw createProblem('not-found');
}

async function requireTaskReportAccess(
  fastify: FastifyInstance,
  taskId: string,
  identityId: string,
  subjectNs: KetoNamespace,
) {
  const canReport = await fastify.permissionChecker.canReportTask(
    taskId,
    identityId,
    subjectNs,
  );
  if (!canReport) throw createProblem('forbidden');
}

async function assertTaskAttemptInTeam(
  fastify: FastifyInstance,
  taskId: string,
  attemptN: number,
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
      'runtime session task does not resolve in team',
    );
  }
  const attempt = await fastify.taskRepository.findAttempt(taskId, attemptN);
  if (!attempt) {
    throw createValidationProblem(
      [
        {
          field: 'attemptN',
          message: `Task ${taskId} attempt ${attemptN} does not exist`,
        },
      ],
      'runtime session task attempt does not exist',
    );
  }
}

async function assertSourceSlotInTeam(
  fastify: FastifyInstance,
  sourceSlotId: string | undefined,
  teamId: string,
) {
  if (!sourceSlotId) return null;
  const slot = await fastify.runtimeSlotRepository.findByIdInTeam(
    sourceSlotId,
    teamId,
  );
  if (!slot) {
    throw createValidationProblem(
      [
        {
          field: 'sourceSlotId',
          message: `Runtime slot ${sourceSlotId} does not resolve in team ${teamId}`,
        },
      ],
      'runtime session source slot does not resolve in team',
    );
  }
  return slot;
}

async function assertProfileInTeam(
  fastify: FastifyInstance,
  profileId: string | undefined,
  teamId: string,
) {
  if (!profileId) return;
  const profile = await fastify.runtimeProfileRepository.findById(profileId);
  if (!profile || profile.teamId !== teamId) {
    throw createValidationProblem(
      [
        {
          field: 'sourceRuntimeProfileId',
          message: `Runtime profile ${profileId} does not resolve in team ${teamId}`,
        },
      ],
      'runtime session profile does not resolve in team',
    );
  }
}

async function assertParentSessionInTeam(
  fastify: FastifyInstance,
  parentSessionId: string | undefined,
  teamId: string,
  identityId: string,
  subjectNs: KetoNamespace,
) {
  if (!parentSessionId) return null;
  const parent = await fastify.runtimeSessionRepository.findByIdInTeam(
    parentSessionId,
    teamId,
  );
  if (!parent) {
    throw createValidationProblem(
      [
        {
          field: 'parentSessionId',
          message: `Parent runtime session ${parentSessionId} does not resolve in team ${teamId}`,
        },
      ],
      'runtime session parent does not resolve in team',
    );
  }
  await requireTaskReadAccess(fastify, parent.taskId, identityId, subjectNs);
  return parent;
}

export async function runtimeSessionRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

  server.put(
    '/runtime-sessions/:taskId/:attemptN',
    {
      schema: {
        operationId: 'uploadRuntimeSession',
        tags: ['runtime-sessions'],
        description:
          'Upload or replace the durable team-scoped runtime session for a task attempt.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        params: RuntimeSessionAttemptParamsSchema,
        body: UploadRuntimeSessionBodySchema,
        response: {
          200: RuntimeSessionSchema,
          400: ValidationProblemDetailsSchema,
          401: ProblemDetailsSchema,
          403: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
          503: ProblemDetailsSchema,
        },
      },
    },
    async (request) => {
      const { identityId, subjectNs, subjectType } = authSubject(request);
      if (subjectType !== 'agent') {
        throw createProblem(
          'forbidden',
          'Runtime sessions can only be uploaded by agents',
        );
      }
      const teamId = requireCurrentTeamId(request, 'runtime sessions');
      const { taskId, attemptN } = request.params;
      const body = request.body;

      await requireTeamAccess(fastify, teamId, identityId, subjectNs);
      await requireTaskReportAccess(fastify, taskId, identityId, subjectNs);
      await assertTaskAttemptInTeam(fastify, taskId, attemptN, teamId);
      const sourceSlot = await assertSourceSlotInTeam(
        fastify,
        body.sourceSlotId,
        teamId,
      );
      await assertProfileInTeam(
        fastify,
        body.sourceRuntimeProfileId ??
          sourceSlot?.runtimeProfileId ??
          undefined,
        teamId,
      );
      await assertParentSessionInTeam(
        fastify,
        body.parentSessionId,
        teamId,
        identityId,
        subjectNs,
      );

      const raw = decodeBase64(body.contentBase64);
      if (raw.byteLength > fastify.runtimeSessionMaxBytes) {
        throw createValidationProblem(
          [
            {
              field: 'contentBase64',
              message: `Runtime session exceeds ${fastify.runtimeSessionMaxBytes} bytes`,
            },
          ],
          'runtime session exceeds max size',
        );
      }
      const compressed = gzipSync(raw);
      const sha256 = createHash('sha256').update(compressed).digest('hex');
      const objectKey = buildRuntimeSessionObjectKey({
        attemptN,
        sha256,
        taskId,
        teamId,
      });

      try {
        await fastify.runtimeSessionStorage.putObject({
          body: compressed,
          contentEncoding: 'gzip',
          contentType: 'application/x-ndjson',
          key: objectKey,
        });
      } catch (err) {
        if (err instanceof RuntimeSessionStorageNotConfiguredError) {
          throw createProblem('service-unavailable', err.message);
        }
        throw err;
      }

      const session = await fastify.runtimeSessionRepository.upsertActive({
        attemptN,
        checkpointKind: 'attempt_final',
        contentEncoding: 'gzip',
        contentType: 'application/x-ndjson',
        objectKey,
        parentSessionId: body.parentSessionId ?? null,
        sessionKind: body.sessionKind,
        sha256,
        sizeBytes: compressed.byteLength,
        sourceRuntimeProfileId:
          body.sourceRuntimeProfileId ?? sourceSlot?.runtimeProfileId ?? null,
        sourceSlotId: body.sourceSlotId ?? null,
        storageClass: 'runtime-session',
        taskId,
        teamId,
      });

      return serializeSession(session);
    },
  );

  server.get(
    '/runtime-sessions/:taskId/:attemptN',
    {
      config: { rateLimit: fastify.rateLimitConfig.read },
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
      const { identityId, subjectNs } = authSubject(request);
      const teamId = requireCurrentTeamId(request, 'runtime sessions');
      const { taskId, attemptN } = request.params;
      await requireTeamAccess(fastify, teamId, identityId, subjectNs);
      await requireTaskReadAccess(fastify, taskId, identityId, subjectNs);
      await assertTaskAttemptInTeam(fastify, taskId, attemptN, teamId);
      const session =
        await fastify.runtimeSessionRepository.findActiveByTaskAttempt(
          teamId,
          taskId,
          attemptN,
        );
      if (!session) throw createProblem('not-found');
      return serializeSession(session);
    },
  );

  server.get(
    '/runtime-sessions/:taskId/:attemptN/content',
    {
      config: { rateLimit: fastify.rateLimitConfig.read },
      schema: {
        operationId: 'downloadRuntimeSession',
        tags: ['runtime-sessions'],
        description:
          'Download the durable team-scoped runtime session content for a task attempt.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        params: RuntimeSessionAttemptParamsSchema,
        response: {
          200: DownloadRuntimeSessionResponseSchema,
          400: ValidationProblemDetailsSchema,
          401: ProblemDetailsSchema,
          403: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
          503: ProblemDetailsSchema,
        },
      },
    },
    async (request) => {
      const { identityId, subjectNs } = authSubject(request);
      const teamId = requireCurrentTeamId(request, 'runtime sessions');
      const { taskId, attemptN } = request.params;
      await requireTeamAccess(fastify, teamId, identityId, subjectNs);
      await requireTaskReadAccess(fastify, taskId, identityId, subjectNs);
      await assertTaskAttemptInTeam(fastify, taskId, attemptN, teamId);
      const session =
        await fastify.runtimeSessionRepository.findActiveByTaskAttempt(
          teamId,
          taskId,
          attemptN,
        );
      if (!session) throw createProblem('not-found');

      try {
        const object = await fastify.runtimeSessionStorage.getObject(
          session.objectKey,
        );
        const raw =
          object.contentEncoding === 'gzip'
            ? gunzipSync(object.body)
            : object.body;
        return {
          contentBase64: raw.toString('base64'),
          session: serializeSession(session),
        };
      } catch (err) {
        if (err instanceof RuntimeSessionStorageNotConfiguredError) {
          throw createProblem('service-unavailable', err.message);
        }
        if (err instanceof MissingRuntimeSessionObjectError) {
          throw createProblem(
            'not-found',
            'runtime session metadata exists but object storage is missing the object',
            { reason: 'missing_remote_session_object' },
          );
        }
        throw err;
      }
    },
  );
}

function decodeBase64(value: string): Buffer {
  const buffer = Buffer.from(value, 'base64');
  if (
    buffer.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')
  ) {
    throw createValidationProblem(
      [
        {
          field: 'contentBase64',
          message: 'contentBase64 is not valid base64',
        },
      ],
      'runtime session content is not valid base64',
    );
  }
  return buffer;
}

function buildRuntimeSessionObjectKey(input: {
  teamId: string;
  taskId: string;
  attemptN: number;
  sha256: string;
}): string {
  return [
    'teams',
    input.teamId,
    'runtime-sessions',
    'tasks',
    input.taskId,
    'attempts',
    String(input.attemptN),
    `${input.sha256}.jsonl.gz`,
  ].join('/');
}
