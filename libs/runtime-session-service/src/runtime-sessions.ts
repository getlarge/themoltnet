import { createReadStream } from 'node:fs';
import { createGunzip, createGzip } from 'node:zlib';

import type { KetoNamespace } from '@moltnet/auth';
import type { PermissionChecker } from '@moltnet/auth';
import {
  BlobBodyNotReadableError,
  BlobTooLargeError,
  stageReadableToTempFile,
} from '@moltnet/blob-storage';
import type {
  RuntimeProfileRepository,
  RuntimeSession,
  RuntimeSessionRepository,
  RuntimeSlotRepository,
  TaskAttempt,
  TaskRepository,
} from '@moltnet/database';
import type { UploadRuntimeSessionQuery } from '@moltnet/tasks';

import { createProblem, createValidationProblem } from './problems.js';
import {
  MissingRuntimeSessionObjectError,
  type RuntimeSessionObject,
  type RuntimeSessionStorage,
  RuntimeSessionStorageNotConfiguredError,
} from './runtime-session-storage.js';

export interface RuntimeSessionServiceDeps {
  logger: RuntimeSessionLogger;
  permissionChecker: PermissionChecker;
  runtimeProfileRepository: RuntimeProfileRepository;
  runtimeSessionMaxBytes: number;
  runtimeSessionRepository: RuntimeSessionRepository;
  runtimeSessionStorage: RuntimeSessionStorage;
  runtimeSlotRepository: RuntimeSlotRepository;
  taskRepository: TaskRepository;
}

export interface RuntimeSessionLogger {
  warn(obj: object, msg: string): void;
}

export interface RuntimeSessionSubject {
  identityId: string;
  subjectNs: KetoNamespace;
}

const ATTEMPT_TERMINAL_STATUSES = new Set<TaskAttempt['status']>([
  'completed',
  'failed',
  'cancelled',
  'aborted',
  'timed_out',
]);

export interface UploadRuntimeSessionInput extends RuntimeSessionSubject {
  attemptN: number;
  body: unknown;
  query: UploadRuntimeSessionQuery;
  taskId: string;
  teamId: string;
}

export interface RuntimeSessionAttemptInput extends RuntimeSessionSubject {
  attemptN: number;
  taskId: string;
  teamId: string;
}

export interface RuntimeSessionDownload {
  object: RuntimeSessionObject;
  session: RuntimeSession;
  stream: NodeJS.ReadableStream;
}

export function createRuntimeSessionService(deps: RuntimeSessionServiceDeps) {
  async function getMetadata(
    input: RuntimeSessionAttemptInput,
  ): Promise<RuntimeSession> {
    await requireTeamAccess(deps, input);
    await requireTaskReadAccess(deps, input);
    await assertTaskAttemptInTeam(deps, input);
    const session = await deps.runtimeSessionRepository.findActiveByTaskAttempt(
      input.teamId,
      input.taskId,
      input.attemptN,
    );
    if (!session) throw createProblem('not-found');
    return session;
  }

  return {
    async upload(input: UploadRuntimeSessionInput): Promise<RuntimeSession> {
      await requireTeamAccess(deps, input);
      const attempt = await assertTaskAttemptInTeam(deps, input);
      assertAttemptUploader(attempt, input.identityId);
      if (!ATTEMPT_TERMINAL_STATUSES.has(attempt.status)) {
        const task = await assertTaskInTeam(deps, input);
        if (task.claimAgentId !== input.identityId) {
          throw createProblem(
            'forbidden',
            'Only the active claiming agent may upload this runtime session',
          );
        }
      }
      await requireUploadAccess(deps, input, attempt);
      const sourceSlot = await assertSourceSlotInTeam(
        deps,
        input.query.sourceSlotId,
        input.teamId,
      );
      await assertProfileInTeam(
        deps,
        input.query.sourceRuntimeProfileId ??
          sourceSlot?.runtimeProfileId ??
          undefined,
        input.teamId,
      );
      await assertParentSessionInTeam(deps, {
        identityId: input.identityId,
        parentSessionId: input.query.parentSessionId,
        subjectNs: input.subjectNs,
        teamId: input.teamId,
      });

      const previousSession =
        await deps.runtimeSessionRepository.findActiveByTaskAttempt(
          input.teamId,
          input.taskId,
          input.attemptN,
        );
      let staged: StagedRuntimeSessionUpload | null = null;
      let objectKey: string | null = null;
      let objectUploaded = false;

      try {
        staged = await stageRuntimeSessionUpload(
          input.body,
          deps.runtimeSessionMaxBytes,
        );
        objectKey = buildRuntimeSessionObjectKey({
          attemptN: input.attemptN,
          sha256: staged.sha256,
          taskId: input.taskId,
          teamId: input.teamId,
        });
        await deps.runtimeSessionStorage.putObject({
          body: createReadStream(staged.path),
          contentEncoding: 'gzip',
          contentLength: staged.compressedSizeBytes,
          contentType: 'application/x-ndjson',
          key: objectKey,
        });
        objectUploaded = true;
        const session = await deps.runtimeSessionRepository.upsertActive({
          attemptN: input.attemptN,
          checkpointKind: 'attempt_final',
          contentEncoding: 'gzip',
          contentType: 'application/x-ndjson',
          objectKey,
          parentSessionId: input.query.parentSessionId ?? null,
          sessionKind: input.query.sessionKind,
          sha256: staged.sha256,
          sizeBytes: staged.compressedSizeBytes,
          sourceRuntimeProfileId:
            input.query.sourceRuntimeProfileId ??
            sourceSlot?.runtimeProfileId ??
            null,
          sourceSlotId: input.query.sourceSlotId ?? null,
          storageClass: 'runtime-session',
          taskId: input.taskId,
          teamId: input.teamId,
        });
        await deleteReplacedObjectIfNeeded(
          deps,
          previousSession?.objectKey,
          objectKey,
        );
        return session;
      } catch (err) {
        if (err instanceof RuntimeSessionStorageNotConfiguredError) {
          throw createProblem('service-unavailable', err.message);
        }
        if (objectUploaded && objectKey) {
          await deleteObjectBestEffort(deps, objectKey);
        }
        throw err;
      } finally {
        await staged?.dispose();
      }
    },

    getMetadata,

    async download(
      input: RuntimeSessionAttemptInput,
    ): Promise<RuntimeSessionDownload> {
      const session = await getMetadata(input);

      try {
        const object = await deps.runtimeSessionStorage.getObject(
          session.objectKey,
        );
        const contentEncoding =
          session.contentEncoding ?? object.contentEncoding ?? null;
        const stream =
          contentEncoding === 'gzip'
            ? object.body.pipe(createGunzip())
            : object.body;
        return { object, session, stream };
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
  };
}

export function serializeRuntimeSession(session: RuntimeSession) {
  return {
    id: session.id,
    teamId: session.teamId,
    taskId: session.taskId,
    attemptN: session.attemptN,
    sourceSlotId: session.sourceSlotId ?? null,
    sourceRuntimeProfileId: session.sourceRuntimeProfileId ?? null,
    sessionKind: session.sessionKind,
    parentSessionId: session.parentSessionId ?? null,
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
  deps: RuntimeSessionServiceDeps,
  input: RuntimeSessionSubject & { teamId: string },
) {
  const canAccess = await deps.permissionChecker.canAccessTeam(
    input.teamId,
    input.identityId,
    input.subjectNs,
  );
  if (!canAccess) throw createProblem('not-found');
}

async function requireTaskReadAccess(
  deps: RuntimeSessionServiceDeps,
  input: RuntimeSessionSubject & { taskId: string },
) {
  const canView = await deps.permissionChecker.canViewTask(
    input.taskId,
    input.identityId,
    input.subjectNs,
  );
  if (!canView) throw createProblem('not-found');
}

async function assertTaskInTeam(
  deps: RuntimeSessionServiceDeps,
  input: { taskId: string; teamId: string },
) {
  const task = await deps.taskRepository.findById(input.taskId);
  if (!task || task.teamId !== input.teamId) {
    throw createValidationProblem(
      [
        {
          field: 'taskId',
          message: `Task ${input.taskId} does not resolve in team ${input.teamId}`,
        },
      ],
      'runtime session task does not resolve in team',
    );
  }
  return task;
}

async function requireUploadAccess(
  deps: RuntimeSessionServiceDeps,
  input: RuntimeSessionSubject & { taskId: string },
  attempt: TaskAttempt,
) {
  if (ATTEMPT_TERMINAL_STATUSES.has(attempt.status)) {
    await requireTaskReadAccess(deps, input);
    return;
  }
}

async function assertTaskAttemptInTeam(
  deps: RuntimeSessionServiceDeps,
  input: { attemptN: number; taskId: string; teamId: string },
): Promise<TaskAttempt> {
  await assertTaskInTeam(deps, input);
  const attempt = await deps.taskRepository.findAttempt(
    input.taskId,
    input.attemptN,
  );
  if (!attempt) {
    throw createValidationProblem(
      [
        {
          field: 'attemptN',
          message: `Task ${input.taskId} attempt ${input.attemptN} does not exist`,
        },
      ],
      'runtime session task attempt does not exist',
    );
  }
  return attempt;
}

function assertAttemptUploader(attempt: TaskAttempt, identityId: string) {
  if (attempt.claimedByAgentId !== identityId) {
    throw createProblem(
      'forbidden',
      'Only the claiming agent may upload this runtime session',
    );
  }
  if (attempt.status === 'claimed') {
    throw createProblem(
      'conflict',
      'Runtime sessions can only be uploaded after the attempt has started',
    );
  }
}

async function assertSourceSlotInTeam(
  deps: RuntimeSessionServiceDeps,
  sourceSlotId: string | undefined,
  teamId: string,
) {
  if (!sourceSlotId) return null;
  const slot = await deps.runtimeSlotRepository.findByIdInTeam(
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
  deps: RuntimeSessionServiceDeps,
  profileId: string | undefined,
  teamId: string,
) {
  if (!profileId) return;
  const profile = await deps.runtimeProfileRepository.findById(profileId);
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
  deps: RuntimeSessionServiceDeps,
  input: RuntimeSessionSubject & {
    parentSessionId: string | undefined;
    teamId: string;
  },
) {
  if (!input.parentSessionId) return null;
  const parent = await deps.runtimeSessionRepository.findByIdInTeam(
    input.parentSessionId,
    input.teamId,
  );
  if (!parent) {
    throw createValidationProblem(
      [
        {
          field: 'parentSessionId',
          message: `Parent runtime session ${input.parentSessionId} does not resolve in team ${input.teamId}`,
        },
      ],
      'runtime session parent does not resolve in team',
    );
  }
  await requireTaskReadAccess(deps, {
    identityId: input.identityId,
    subjectNs: input.subjectNs,
    taskId: parent.taskId,
  });
  return parent;
}

interface StagedRuntimeSessionUpload {
  path: string;
  sha256: string;
  compressedSizeBytes: number;
  dispose(): Promise<void>;
}

async function stageRuntimeSessionUpload(
  body: unknown,
  maxBytes: number,
): Promise<StagedRuntimeSessionUpload> {
  try {
    const staged = await stageReadableToTempFile({
      body,
      fileName: 'session.jsonl.gz',
      maxBytes,
      tmpPrefix: 'moltnet-runtime-session-',
      transforms: [createGzip()],
    });
    return {
      compressedSizeBytes: staged.sizeBytes,
      path: staged.path,
      sha256: staged.sha256,
      dispose: () => staged.dispose(),
    };
  } catch (err) {
    if (err instanceof BlobBodyNotReadableError) {
      throw createValidationProblem(
        [
          {
            field: 'body',
            message: 'runtime session content must be a stream',
          },
        ],
        'runtime session content is required',
      );
    }
    if (err instanceof BlobTooLargeError) {
      throw createValidationProblem(
        [
          {
            field: 'body',
            message: `Runtime session exceeds ${err.maxBytes} bytes`,
          },
        ],
        'runtime session exceeds max size',
      );
    }
    throw err;
  }
}

async function deleteReplacedObjectIfNeeded(
  deps: RuntimeSessionServiceDeps,
  previousObjectKey: string | undefined,
  nextObjectKey: string,
) {
  if (!previousObjectKey || previousObjectKey === nextObjectKey) return;
  await deleteObjectBestEffort(deps, previousObjectKey);
}

async function deleteObjectBestEffort(
  deps: RuntimeSessionServiceDeps,
  objectKey: string,
) {
  try {
    await deps.runtimeSessionStorage.deleteObject(objectKey);
  } catch (err) {
    deps.logger.warn(
      { err, objectKey },
      'runtime-session.object_delete_failed',
    );
  }
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
