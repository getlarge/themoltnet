import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

import type { ClaimedTask } from '@themoltnet/agent-runtime';

import {
  type DaemonSlotRegistry,
  type ResolvedProducerDaemonSlot,
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

  const producer = slotRegistry.findLatestProducerSlotByTaskAttempt(
    targetTaskId,
    targetAttemptN,
  );
  if (!producer) {
    throw new ProducerContextResolutionError(
      `No persisted producer daemon slot found for task ${targetTaskId} attempt ${targetAttemptN}`,
    );
  }

  const sourceSessionPath = resolveProducerSessionPath(producer);
  if (!sourceSessionPath) {
    throw new ProducerContextResolutionError(
      `Producer task ${targetTaskId} attempt ${targetAttemptN} has no persisted Pi session path`,
    );
  }

  const attachedWorkspace = resolveProducerWorkspaceAttachment(
    producer,
    stateDirs,
  );

  return {
    ...basePlan,
    workspaceMode: attachedWorkspace.mode,
    worktreeBranch: attachedWorkspace.branch,
    workspaceAttachment: {
      mountPath: attachedWorkspace.mountPath,
      cwdPath: attachedWorkspace.cwdPath,
      shadowWrites: 'tmpfs',
    },
    sessionPersistence: {
      sessionDir: `${stateDirs.piSessionsDir}/judge-${claimedTask.task.id}-attempt-${claimedTask.attemptN}`,
      forkFromSessionPath: sourceSessionPath,
    },
  };
}

function resolveProducerSessionPath(
  producer: ResolvedProducerDaemonSlot,
): string | null {
  const explicit = producer.session?.sessionPath ?? null;
  if (explicit && existsSync(explicit)) return explicit;

  const sessionDir = producer.session?.sessionDir ?? null;
  if (!sessionDir || !existsSync(sessionDir)) return null;

  const latest = resolveLatestPiSessionPath(sessionDir);
  return latest && existsSync(latest) ? latest : null;
}

function resolveProducerWorkspaceAttachment(
  producer: ResolvedProducerDaemonSlot,
  stateDirs: DaemonStateDirs,
): {
  mountPath: string;
  cwdPath: string;
  mode: DaemonTaskExecutionPlan['workspaceMode'];
  branch: string | null;
} {
  const workspacePath = producer.workspace?.worktreePath ?? null;
  if (workspacePath) {
    if (!existsSync(workspacePath)) {
      throw new ProducerContextResolutionError(
        `Producer workspace path is missing on disk: ${workspacePath}`,
      );
    }
    return {
      mountPath: workspacePath,
      cwdPath: workspacePath,
      mode: producer.workspace?.worktreeBranch
        ? 'dedicated_worktree'
        : 'scratch_mount',
      branch: producer.workspace?.worktreeBranch ?? null,
    };
  }

  const sharedMountRoot = dirname(dirname(stateDirs.rootDir));
  if (!existsSync(sharedMountRoot)) {
    throw new ProducerContextResolutionError(
      `Shared producer mount root is missing on disk: ${sharedMountRoot}`,
    );
  }
  return {
    mountPath: sharedMountRoot,
    cwdPath: sharedMountRoot,
    mode: 'shared_mount',
    branch: null,
  };
}
