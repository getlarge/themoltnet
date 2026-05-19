import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ClaimedTask } from '@themoltnet/agent-runtime';

import {
  type DaemonSlotRegistry,
  type PersistedProducerTaskAttemptContext,
  resolveLatestPiSessionPath,
} from './daemon-slot-registry.js';
import type { DaemonStateDirs } from './state-dir.js';
import {
  buildDaemonTaskExecutionPlan,
  type DaemonSlotIdentity,
  type DaemonTaskExecutionPlan,
} from './task-execution-plan.js';

type CachedTask = Pick<ClaimedTask, 'task' | 'attemptN'>;

export interface ExecutionPlanCache {
  getOrCreate(claimedTask: CachedTask): DaemonTaskExecutionPlan;
  delete(claimedTask: CachedTask): void;
}

export class ProducerContextResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProducerContextResolutionError';
  }
}

export function createExecutionPlanCache(args: {
  stateDirs: DaemonStateDirs;
  slotIdentity: DaemonSlotIdentity;
  warmSessionTtlSec: number;
  slotRegistry: DaemonSlotRegistry;
}): ExecutionPlanCache {
  const cache = new Map<string, DaemonTaskExecutionPlan>();

  return {
    getOrCreate(claimedTask: CachedTask): DaemonTaskExecutionPlan {
      const key = buildClaimedTaskKey(claimedTask);
      const existing = cache.get(key);
      if (existing) return existing;

      const basePlan = buildDaemonTaskExecutionPlan(
        claimedTask.task,
        args.stateDirs,
        args.slotIdentity,
        args.warmSessionTtlSec,
      );
      const plan = maybeAttachProducerContext(
        claimedTask,
        basePlan,
        args.stateDirs,
        args.slotRegistry,
      );
      cache.set(key, plan);
      return plan;
    },
    delete(claimedTask: CachedTask): void {
      cache.delete(buildClaimedTaskKey(claimedTask));
    },
  };
}

function buildClaimedTaskKey(task: CachedTask): string {
  return `${task.task.id}:${task.attemptN}`;
}

function maybeAttachProducerContext(
  claimedTask: CachedTask,
  basePlan: DaemonTaskExecutionPlan,
  stateDirs: DaemonStateDirs,
  slotRegistry: DaemonSlotRegistry,
): DaemonTaskExecutionPlan {
  if (claimedTask.task.taskType !== 'judge_eval_attempt') {
    return basePlan;
  }

  const targetTaskId =
    typeof (claimedTask.task.input as { targetTaskId?: unknown })
      .targetTaskId === 'string'
      ? (claimedTask.task.input as { targetTaskId: string }).targetTaskId
      : null;
  const targetAttemptN =
    typeof (claimedTask.task.input as { targetAttemptN?: unknown })
      .targetAttemptN === 'number'
      ? (claimedTask.task.input as { targetAttemptN: number }).targetAttemptN
      : null;

  if (!targetTaskId || !targetAttemptN) {
    throw new ProducerContextResolutionError(
      'judge_eval_attempt is missing targetTaskId/targetAttemptN',
    );
  }

  const producerContext =
    slotRegistry.findPersistedProducerTaskAttemptContext(
      targetTaskId,
      targetAttemptN,
    ) ??
    producerToPersistedContext(
      slotRegistry.findLatestProducerSlotByTaskAttempt(
        targetTaskId,
        targetAttemptN,
      ),
    );
  if (!producerContext) {
    throw new ProducerContextResolutionError(
      `No persisted producer context found for task ${targetTaskId} attempt ${targetAttemptN}`,
    );
  }

  const sourceSessionPath = resolveProducerSessionPath(producerContext);
  if (!sourceSessionPath) {
    throw new ProducerContextResolutionError(
      `Producer task ${targetTaskId} attempt ${targetAttemptN} has no persisted Pi session path`,
    );
  }

  const copiedWorkspaceSource = resolveProducerWorkspaceCopySource(
    producerContext,
    stateDirs,
  );

  return {
    ...basePlan,
    workspaceMode: 'scratch_mount',
    worktreeBranch: null,
    workspaceSeed: {
      copyFromPath: copiedWorkspaceSource,
      source: 'producer',
    },
    sessionPersistence: {
      sessionDir: `${stateDirs.piSessionsDir}/judge-${claimedTask.task.id}-attempt-${claimedTask.attemptN}`,
      forkFromSessionPath: sourceSessionPath,
    },
  };
}

function resolveProducerSessionPath(
  producer: PersistedProducerTaskAttemptContext,
): string | null {
  const explicit = producer.sessionPath ?? null;
  if (explicit && existsSync(explicit)) return explicit;

  const sessionDir = producer.sessionDir ?? null;
  if (!sessionDir || !existsSync(sessionDir)) return null;

  const latest = resolveLatestPiSessionPath(sessionDir);
  return latest && existsSync(latest) ? latest : null;
}

function resolveProducerWorkspaceCopySource(
  producer: PersistedProducerTaskAttemptContext,
  stateDirs: DaemonStateDirs,
): string {
  const workspacePath = producer.worktreePath ?? null;
  if (workspacePath) {
    if (existsSync(workspacePath)) {
      return workspacePath;
    }
    const recoveredPath = recoverScratchWorkspacePath(producer, stateDirs);
    if (recoveredPath) return recoveredPath;
    throw new ProducerContextResolutionError(
      `Producer workspace path is missing on disk: ${workspacePath}`,
    );
  }

  const sharedMountRoot = dirname(dirname(stateDirs.rootDir));
  if (!existsSync(sharedMountRoot)) {
    throw new ProducerContextResolutionError(
      `Shared producer mount root is missing on disk: ${sharedMountRoot}`,
    );
  }
  return sharedMountRoot;
}

function recoverScratchWorkspacePath(
  producer: PersistedProducerTaskAttemptContext,
  stateDirs: DaemonStateDirs,
): string | null {
  if (producer.worktreeBranch) return null;
  if (!producer.workspaceId) return null;

  const fallback = join(
    stateDirs.rootDir,
    'task-workspaces',
    producer.workspaceId,
  );
  return existsSync(fallback) ? fallback : null;
}

function producerToPersistedContext(
  producer: ReturnType<
    DaemonSlotRegistry['findLatestProducerSlotByTaskAttempt']
  >,
): PersistedProducerTaskAttemptContext | null {
  if (!producer) return null;
  return {
    taskId: producer.slot.lastTaskId,
    attemptN: producer.slot.lastAttemptN,
    taskType: producer.slot.taskType,
    sessionDir: producer.session?.sessionDir ?? null,
    sessionPath: producer.session?.sessionPath ?? null,
    workspaceId: producer.workspace?.workspaceId ?? null,
    worktreePath: producer.workspace?.worktreePath ?? null,
    worktreeBranch: producer.workspace?.worktreeBranch ?? null,
    recordedAtMs: producer.slot.lastUsedAtMs,
    expiresAtMs: producer.slot.expiresAtMs,
  };
}
