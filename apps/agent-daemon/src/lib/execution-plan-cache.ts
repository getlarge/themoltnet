import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

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
      const plan = maybeAttachWarmSlotContext(
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

type WarmSlotResolution =
  | {
      kind: 'found';
      producerSlot: ResolvedProducerDaemonSlot;
      sessionPath: string;
      workspacePath: string;
    }
  | { kind: 'missing' }
  | { kind: 'no-session-path' };

function resolveWarmSlot(
  slotRegistry: DaemonSlotRegistry,
  sourceTaskId: string,
  sourceAttemptN: number,
  stateDirs: DaemonStateDirs,
): WarmSlotResolution {
  const producerContext = slotRegistry.findLatestProducerSlotByTaskAttempt(
    sourceTaskId,
    sourceAttemptN,
  );
  if (!producerContext) return { kind: 'missing' };

  const sourceSessionPath = resolveProducerSessionPath(producerContext);
  if (!sourceSessionPath) return { kind: 'no-session-path' };

  const copiedWorkspaceSource = resolveProducerWorkspaceCopySource(
    producerContext,
    stateDirs,
  );

  return {
    kind: 'found',
    producerSlot: producerContext,
    sessionPath: sourceSessionPath,
    workspacePath: copiedWorkspaceSource,
  };
}

function maybeAttachWarmSlotContext(
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

  const resolution = resolveWarmSlot(
    slotRegistry,
    targetTaskId,
    targetAttemptN,
    stateDirs,
  );

  if (resolution.kind === 'missing') {
    throw new ProducerContextResolutionError(
      `No live producer daemon slot found for task ${targetTaskId} attempt ${targetAttemptN}`,
    );
  }
  if (resolution.kind === 'no-session-path') {
    throw new ProducerContextResolutionError(
      `Producer task ${targetTaskId} attempt ${targetAttemptN} has no persisted Pi session path`,
    );
  }

  return {
    ...basePlan,
    workspaceMode: 'scratch_mount',
    worktreeBranch: null,
    workspaceSeed: {
      copyFromPath: resolution.workspacePath,
      source: 'producer',
    },
    sessionPersistence: {
      sessionDir: `${stateDirs.piSessionsDir}/judge-${claimedTask.task.id}-attempt-${claimedTask.attemptN}`,
      forkFromSessionPath: resolution.sessionPath,
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

function resolveProducerWorkspaceCopySource(
  producer: ResolvedProducerDaemonSlot,
  stateDirs: DaemonStateDirs,
): string {
  const workspacePath = producer.workspace?.worktreePath ?? null;
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
  producer: ResolvedProducerDaemonSlot,
  stateDirs: DaemonStateDirs,
): string | null {
  if (producer.workspace?.worktreeBranch) return null;
  if (!producer.workspace?.workspaceId) return null;

  const fallback = join(
    stateDirs.rootDir,
    'task-workspaces',
    producer.workspace.workspaceId,
  );
  return existsSync(fallback) ? fallback : null;
}
