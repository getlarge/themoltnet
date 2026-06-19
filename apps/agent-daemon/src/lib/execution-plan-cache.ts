import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  type DaemonSlotIdentity,
  type DaemonSlotRegistry,
  type ResolvedProducerDaemonSlot,
  resolveLatestPiSessionPath,
} from '@themoltnet/agent-daemon-state';
import type { ClaimedTask } from '@themoltnet/agent-runtime';

import type { DaemonStateDirs } from './state-dir.js';
import {
  buildDaemonTaskExecutionPlan,
  type DaemonTaskExecutionPlan,
} from './task-execution-plan.js';

type CachedTask = Pick<ClaimedTask, 'task' | 'attemptN'>;

export interface ExecutionPlanCache {
  getOrCreate(claimedTask: CachedTask): Promise<DaemonTaskExecutionPlan>;
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
    async getOrCreate(
      claimedTask: CachedTask,
    ): Promise<DaemonTaskExecutionPlan> {
      const key = buildClaimedTaskKey(claimedTask);
      const existing = cache.get(key);
      if (existing) return existing;

      const basePlan = buildDaemonTaskExecutionPlan(
        claimedTask.task,
        args.stateDirs,
        args.slotIdentity,
        args.warmSessionTtlSec,
      );
      const plan = await maybeAttachWarmSlotContext(
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

async function resolveWarmSlot(
  slotRegistry: DaemonSlotRegistry,
  sourceTaskId: string,
  sourceAttemptN: number,
  stateDirs: DaemonStateDirs,
): Promise<WarmSlotResolution> {
  const producerContext =
    await slotRegistry.findLatestProducerSlotByTaskAttempt(
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

async function maybeAttachWarmSlotContext(
  claimedTask: CachedTask,
  basePlan: DaemonTaskExecutionPlan,
  stateDirs: DaemonStateDirs,
  slotRegistry: DaemonSlotRegistry,
): Promise<DaemonTaskExecutionPlan> {
  if (claimedTask.task.taskType === 'freeform') {
    const continueFrom = (
      claimedTask.task.input as {
        continueFrom?: {
          taskId: string;
          attemptN: number;
          mode?: 'extend' | 'fork';
        };
      }
    ).continueFrom;

    if (!continueFrom) return basePlan;

    const resolution = await resolveWarmSlot(
      slotRegistry,
      continueFrom.taskId,
      continueFrom.attemptN,
      stateDirs,
    );

    if (resolution.kind === 'missing') {
      throw new ProducerContextResolutionError(
        `Continuation source task ${continueFrom.taskId} attempt ${continueFrom.attemptN} has no live daemon slot on this daemon — claim affinity filter should have prevented this claim`,
      );
    }
    if (resolution.kind === 'no-session-path') {
      throw new ProducerContextResolutionError(
        `Continuation source attempt ${continueFrom.taskId}/${continueFrom.attemptN} has no persisted Pi session path`,
      );
    }

    const sessionDir = `${stateDirs.piSessionsDir}/continue-${claimedTask.task.id}-attempt-${claimedTask.attemptN}`;
    const parentBranch =
      resolution.producerSlot.workspace?.worktreeBranch ?? null;

    if (continueFrom.mode === 'fork') {
      // Fork: diverge onto a NEW branch cut from the parent's tip, in a fresh
      // (unique) workspace. The session is still copied (forkFromSessionPath),
      // but git state forks cleanly so the new chain is a separate PR.
      if (!parentBranch) {
        throw new ProducerContextResolutionError(
          `Cannot fork continuation of ${continueFrom.taskId}/${continueFrom.attemptN}: producer slot has no worktree branch to fork from`,
        );
      }
      const forkWorkspaceId = `fork-${claimedTask.task.id}-attempt-${claimedTask.attemptN}`;
      const forkBranch = `${parentBranch}-fork-${claimedTask.attemptN}`;
      return {
        ...basePlan,
        workspaceMode: 'dedicated_worktree',
        workspaceId: forkWorkspaceId,
        worktreeBranch: forkBranch,
        worktreeBaseRef: parentBranch,
        workspaceKind: 'fork',
        sessionPersistence: {
          sessionDir,
          forkFromSessionPath: resolution.sessionPath,
        },
        // No workspaceSeed: the worktree is created by branching, not copying.
      };
    }

    // extend (default): share the parent's branch/workspace. Cross-profile safe
    // now that workspaces are refcounted.
    return {
      ...basePlan,
      workspaceMode: 'dedicated_worktree',
      workspaceId: resolution.producerSlot.workspace?.workspaceId ?? null,
      worktreeBranch: parentBranch,
      sessionPersistence: {
        sessionDir,
        forkFromSessionPath: resolution.sessionPath,
      },
      // Importantly: NO workspaceSeed. Continuation mounts the parent's
      // worktree branch directly via worktreeBranch; we do not copy.
    };
  }

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

  const resolution = await resolveWarmSlot(
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
    workspaceKind: 'scratch',
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
