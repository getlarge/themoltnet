import { createReadStream } from 'node:fs';

import type { KetoNamespace, PermissionChecker } from '@moltnet/auth';
import {
  BlobBodyNotReadableError,
  BlobTooLargeError,
  stageReadableToTempFile,
} from '@moltnet/blob-storage';
import { computeBytesCidFromSha256 } from '@moltnet/crypto-service';
import type {
  TaskArtifact,
  TaskArtifactRepository,
  TaskRepository,
} from '@moltnet/database';

import {
  MissingTaskArtifactObjectError,
  type TaskArtifactObject,
  type TaskArtifactStorage,
  TaskArtifactStorageNotConfiguredError,
} from './task-artifact-storage.js';

export interface TaskArtifactLogger {
  warn(obj: object, msg: string): void;
}

export interface TaskArtifactServiceDeps {
  logger: TaskArtifactLogger;
  objectStorage: TaskArtifactStorage;
  permissionChecker: PermissionChecker;
  taskArtifactMaxBytes: number;
  taskArtifactRepository: TaskArtifactRepository;
  taskRepository: TaskRepository;
}

export interface TaskArtifactSubject {
  identityId: string;
  subjectNs: KetoNamespace;
}

export interface UploadTaskArtifactInput extends TaskArtifactSubject {
  attemptN: number;
  body: unknown;
  contentEncoding?: string | null;
  contentType: string;
  kind: string;
  taskId: string;
  teamId: string;
  title: string;
}

export interface TaskArtifactTaskInput extends TaskArtifactSubject {
  taskId: string;
  teamId: string;
}

export interface TaskArtifactAttemptInput extends TaskArtifactTaskInput {
  attemptN: number;
}

export interface DownloadTaskArtifactInput extends TaskArtifactAttemptInput {
  cid: string;
}

export interface TaskArtifactDownload {
  artifact: TaskArtifact;
  object: TaskArtifactObject;
  stream: NodeJS.ReadableStream;
}

export class TaskArtifactServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'TaskArtifactServiceError';
  }
}

const ATTEMPT_TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'aborted',
  'timed_out',
]);

export function createTaskArtifactService(deps: TaskArtifactServiceDeps) {
  async function listForTask(
    input: TaskArtifactTaskInput,
  ): Promise<TaskArtifact[]> {
    await requireTeamAccess(deps, input);
    await requireTaskReadAccess(deps, input);
    await assertTaskInTeam(deps, input);
    return deps.taskArtifactRepository.listForTask({
      taskId: input.taskId,
      teamId: input.teamId,
    });
  }

  return {
    async upload(input: UploadTaskArtifactInput): Promise<TaskArtifact> {
      await requireTeamAccess(deps, input);
      const attempt = await assertTaskAttemptInTeam(deps, input);
      if (attempt.claimedByAgentId !== input.identityId) {
        throw new TaskArtifactServiceError(
          403,
          'Only the claiming agent may upload task artifacts',
        );
      }
      if (attempt.status === 'claimed') {
        throw new TaskArtifactServiceError(
          409,
          'Task artifacts can only be uploaded after the attempt has started',
        );
      }
      if (ATTEMPT_TERMINAL_STATUSES.has(attempt.status)) {
        throw new TaskArtifactServiceError(
          409,
          `Attempt ${input.attemptN} is already in terminal state: ${attempt.status}`,
        );
      }
      const canReport = await deps.permissionChecker.canReportTask(
        input.taskId,
        input.identityId,
        input.subjectNs,
      );
      if (!canReport) {
        throw new TaskArtifactServiceError(
          403,
          'Not authorized to report on this task',
        );
      }

      const staged = await stageArtifactUpload(input.body, {
        maxBytes: deps.taskArtifactMaxBytes,
      });
      const objectKey = buildArtifactObjectKey(input.teamId, staged.cid);
      let objectUploaded = false;
      try {
        const existing = await deps.objectStorage.headObject(objectKey);
        if (!existing) {
          await deps.objectStorage.putObject({
            body: createReadStream(staged.path),
            contentEncoding: input.contentEncoding ?? null,
            contentLength: staged.sizeBytes,
            contentType: input.contentType,
            key: objectKey,
          });
          objectUploaded = true;
        }
        return await deps.taskArtifactRepository.createForAttempt({
          attemptN: input.attemptN,
          cid: staged.cid,
          contentEncoding: input.contentEncoding ?? null,
          contentType: input.contentType,
          createdByAgentId: input.identityId,
          kind: input.kind,
          objectKey,
          sha256: staged.sha256,
          sizeBytes: staged.sizeBytes,
          taskId: input.taskId,
          teamId: input.teamId,
          title: input.title,
        });
      } catch (err) {
        if (err instanceof TaskArtifactStorageNotConfiguredError) {
          throw new TaskArtifactServiceError(503, err.message);
        }
        if (objectUploaded) {
          deps.logger.warn(
            { objectKey, err },
            'task artifact metadata write failed after object upload',
          );
        }
        throw err;
      } finally {
        await staged.dispose();
      }
    },

    listForTask,

    async download(
      input: DownloadTaskArtifactInput,
    ): Promise<TaskArtifactDownload> {
      await requireTeamAccess(deps, input);
      await requireTaskReadAccess(deps, input);
      await assertTaskAttemptInTeam(deps, input);
      const artifact = await deps.taskArtifactRepository.findByCidForAttempt({
        attemptN: input.attemptN,
        cid: input.cid,
        taskId: input.taskId,
        teamId: input.teamId,
      });
      if (!artifact) {
        throw new TaskArtifactServiceError(404, 'Task artifact not found');
      }
      try {
        const object = await deps.objectStorage.getObject(artifact.objectKey);
        return { artifact, object, stream: object.body };
      } catch (err) {
        if (err instanceof TaskArtifactStorageNotConfiguredError) {
          throw new TaskArtifactServiceError(503, err.message);
        }
        if (err instanceof MissingTaskArtifactObjectError) {
          deps.logger.warn(
            { artifactId: artifact.id, cid: artifact.cid, err },
            'task artifact metadata exists but object storage is missing the object',
          );
          throw new TaskArtifactServiceError(503, err.message);
        }
        throw err;
      }
    },
  };
}

export function serializeTaskArtifact(artifact: TaskArtifact) {
  return {
    id: artifact.id,
    teamId: artifact.teamId,
    taskId: artifact.taskId,
    attemptN: artifact.attemptN,
    kind: artifact.kind,
    title: artifact.title,
    contentType: artifact.contentType,
    contentEncoding: artifact.contentEncoding ?? null,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
    cid: artifact.cid,
    createdByAgentId: artifact.createdByAgentId,
    expiresAt: artifact.expiresAt?.toISOString() ?? null,
    createdAt: artifact.createdAt.toISOString(),
  };
}

async function requireTeamAccess(
  deps: TaskArtifactServiceDeps,
  input: TaskArtifactSubject & { teamId: string },
) {
  const canAccess = await deps.permissionChecker.canAccessTeam(
    input.teamId,
    input.identityId,
    input.subjectNs,
  );
  if (!canAccess) {
    throw new TaskArtifactServiceError(404, 'Task not found');
  }
}

async function assertTaskAttemptInTeam(
  deps: TaskArtifactServiceDeps,
  input: { attemptN: number; taskId: string; teamId: string },
) {
  await assertTaskInTeam(deps, input);
  const attempt = await deps.taskRepository.findAttempt(
    input.taskId,
    input.attemptN,
  );
  if (!attempt) {
    throw new TaskArtifactServiceError(404, 'Attempt not found');
  }
  return attempt;
}

async function assertTaskInTeam(
  deps: TaskArtifactServiceDeps,
  input: { taskId: string; teamId: string },
) {
  const task = await deps.taskRepository.findById(input.taskId);
  if (!task || task.teamId !== input.teamId) {
    throw new TaskArtifactServiceError(404, 'Task not found');
  }
  return task;
}

async function requireTaskReadAccess(
  deps: TaskArtifactServiceDeps,
  input: TaskArtifactSubject & { taskId: string },
) {
  const canView = await deps.permissionChecker.canViewTask(
    input.taskId,
    input.identityId,
    input.subjectNs,
  );
  if (!canView) {
    throw new TaskArtifactServiceError(404, 'Task not found');
  }
}

async function stageArtifactUpload(body: unknown, input: { maxBytes: number }) {
  try {
    const staged = await stageReadableToTempFile({
      body,
      fileName: 'artifact',
      maxBytes: input.maxBytes,
      tmpPrefix: 'moltnet-task-artifact-',
    });
    return {
      ...staged,
      cid: computeBytesCidFromSha256(staged.sha256Bytes),
    };
  } catch (err) {
    if (err instanceof BlobBodyNotReadableError) {
      throw new TaskArtifactServiceError(
        400,
        'task artifact content must be a stream',
      );
    }
    if (err instanceof BlobTooLargeError) {
      throw new TaskArtifactServiceError(
        400,
        `Task artifact exceeds ${err.maxBytes} bytes`,
      );
    }
    throw err;
  }
}

function buildArtifactObjectKey(teamId: string, cid: string): string {
  return ['teams', teamId, 'artifacts', cid].join('/');
}
