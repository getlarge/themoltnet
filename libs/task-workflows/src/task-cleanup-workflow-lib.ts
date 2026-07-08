import type {
  RuntimeSessionCleanupRef,
  Task,
  TaskArtifactCleanupRef,
} from '@moltnet/database';

export interface TaskCleanupLogger {
  warn(payload: unknown, message: string): void;
  error(payload: unknown, message: string): void;
}

export interface TaskCleanupManifestTask {
  id: string;
  teamId: string;
  diaryId: string | null;
  claimAgentId: string | null;
}

export interface TaskCleanupManifest {
  tasks: TaskCleanupManifestTask[];
  taskArtifacts: TaskArtifactCleanupRef[];
  runtimeSessions: RuntimeSessionCleanupRef[];
  skippedProtected: number;
  batchFull: boolean;
  createdAt: string;
}

export function toCleanupManifestTask(
  task: Pick<Task, 'id' | 'teamId' | 'diaryId' | 'claimAgentId'>,
): TaskCleanupManifestTask {
  return {
    id: task.id,
    teamId: task.teamId,
    diaryId: task.diaryId,
    claimAgentId: task.claimAgentId,
  };
}

export function filterCleanupManifestByTaskIds(
  manifest: TaskCleanupManifest,
  taskIds: string[],
): TaskCleanupManifest {
  const taskIdSet = new Set(taskIds);
  return {
    ...manifest,
    tasks: manifest.tasks.filter((task) => taskIdSet.has(task.id)),
    taskArtifacts: manifest.taskArtifacts.filter((artifact) =>
      taskIdSet.has(artifact.taskId),
    ),
    runtimeSessions: manifest.runtimeSessions.filter((session) =>
      taskIdSet.has(session.taskId),
    ),
  };
}

export async function deleteObjectsWithLocalRetries(input: {
  kind: 'task_artifact' | 'runtime_session';
  objectKeys: string[];
  deleteObjects: (objectKeys: string[]) => Promise<void>;
  logger: TaskCleanupLogger;
}): Promise<void> {
  if (input.objectKeys.length === 0) return;
  const maxAttempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await input.deleteObjects(input.objectKeys);
      return;
    } catch (err) {
      lastError = err;
      input.logger.warn(
        {
          err,
          kind: input.kind,
          attempt,
          maxAttempts,
          objectCount: input.objectKeys.length,
          sampleObjectKeys: input.objectKeys.slice(0, 20),
        },
        'maintenance: task cleanup object delete attempt failed',
      );
    }
  }
  input.logger.error(
    {
      err: lastError,
      kind: input.kind,
      objectCount: input.objectKeys.length,
      sampleObjectKeys: input.objectKeys.slice(0, 20),
    },
    'maintenance: task cleanup object delete exhausted local retries',
  );
  throw lastError;
}
