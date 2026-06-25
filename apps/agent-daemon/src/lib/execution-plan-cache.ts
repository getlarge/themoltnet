import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ClaimedTask } from '@themoltnet/agent-runtime';

import type { DaemonSlotIdentity } from './daemon-slot-identity.js';
import type { RuntimeSessionStore } from './runtime-sessions.js';
import { resolveLatestPiSessionPath } from './session-files.js';
import type { DaemonStateDirs } from './state-dir.js';
import {
  buildDaemonTaskExecutionPlan,
  type DaemonTaskExecutionPlan,
  type RuntimeProfileWorkspacePolicy,
} from './task-execution-plan.js';

export interface ResolvedRuntimeSlotContext {
  slot: {
    id: string;
    expiresAtMs: number;
    runtimeProfileId: string | null;
  };
  session: {
    sessionDir: string;
    sessionPath: string | null;
  } | null;
  workspace: {
    workspaceId: string;
    worktreePath: string;
    worktreeBranch: string | null;
    kind: 'origin' | 'fork' | 'scratch';
  } | null;
}

export interface RuntimeSlotStore {
  beginSlot(input: {
    teamId: string;
    agentName: string;
    runtimeProfileId: string;
    provider: string;
    model: string;
    slotKey: string;
    taskType: string;
    sessionDir: string | null;
    sessionPath: string | null;
    workspaceId: string | null;
    worktreePath: string | null;
    worktreeBranch: string | null;
    workspaceKind?: 'origin' | 'fork' | 'scratch';
    lastTaskId: string;
    lastAttemptN: number;
  }): Promise<void>;
  finishSlot(
    teamId: string,
    taskId: string,
    attemptN: number,
    identity: DaemonSlotIdentity,
    slotKey: string,
    provider: string,
    model: string,
    sessionPath: string | null,
  ): Promise<void>;
  findLatestSlotByTaskAttempt(
    teamId: string,
    taskId: string,
    attemptN: number,
  ): Promise<ResolvedRuntimeSlotContext | null>;
  close(): Promise<void>;
}

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
  workspacePolicy?: RuntimeProfileWorkspacePolicy;
  slotRegistry: RuntimeSlotStore;
  runtimeSessionStore?: RuntimeSessionStore;
}): ExecutionPlanCache {
  const cache = new Map<string, DaemonTaskExecutionPlan>();
  const runtimeSessionStore =
    args.runtimeSessionStore ?? createNullRuntimeSessionStore();

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
        args.workspacePolicy,
      );
      const plan = await maybeAttachWarmSlotContext(
        claimedTask,
        basePlan,
        args.stateDirs,
        args.slotRegistry,
        runtimeSessionStore,
      );
      assertPlanAllowedByWorkspacePolicy(plan, args.workspacePolicy);
      cache.set(key, plan);
      return plan;
    },
    delete(claimedTask: CachedTask): void {
      cache.delete(buildClaimedTaskKey(claimedTask));
    },
  };
}

function createNullRuntimeSessionStore(): RuntimeSessionStore {
  return {
    async findRuntimeSessionByTaskAttempt() {
      return null;
    },
    async hydrateSession() {
      throw new ProducerContextResolutionError(
        'Cannot hydrate runtime session: no runtime session store configured',
      );
    },
    async uploadAttemptFinal() {
      // Existing tests and local-only flows do not publish remote session state.
    },
  };
}

function assertPlanAllowedByWorkspacePolicy(
  plan: DaemonTaskExecutionPlan,
  policy: RuntimeProfileWorkspacePolicy | undefined,
): void {
  const allowed = new Set(
    policy?.allowedWorkspaceModes && policy.allowedWorkspaceModes.length > 0
      ? policy.allowedWorkspaceModes
      : ['none', 'shared_mount', 'dedicated_worktree'],
  );
  const effectiveMode = planToRuntimeProfileWorkspaceMode(plan);
  if (!allowed.has(effectiveMode)) {
    throw new Error(
      `Runtime profile forbids final workspace mode "${effectiveMode}" for this task`,
    );
  }
}

function planToRuntimeProfileWorkspaceMode(
  plan: DaemonTaskExecutionPlan,
): 'none' | 'shared_mount' | 'dedicated_worktree' {
  if (plan.workspaceMode === 'scratch_mount') return 'none';
  if (plan.workspaceMode === 'dedicated_worktree' && !plan.worktreeBranch) {
    return 'shared_mount';
  }
  return plan.workspaceMode;
}

function buildClaimedTaskKey(task: CachedTask): string {
  return `${task.task.id}:${task.attemptN}`;
}

type WarmSlotResolution =
  | {
      kind: 'found';
      producerSlot: ResolvedRuntimeSlotContext;
      sessionPath: string;
      workspacePath: string;
    }
  | { kind: 'missing' }
  | { kind: 'no-session-path' };

async function resolveWarmSlot(
  slotRegistry: RuntimeSlotStore,
  runtimeSessionStore: RuntimeSessionStore,
  teamId: string,
  sourceTaskId: string,
  sourceAttemptN: number,
  stateDirs: DaemonStateDirs,
): Promise<WarmSlotResolution> {
  const remoteSession =
    await runtimeSessionStore.findRuntimeSessionByTaskAttempt(
      teamId,
      sourceTaskId,
      sourceAttemptN,
    );
  const producerContext = await slotRegistry.findLatestSlotByTaskAttempt(
    teamId,
    sourceTaskId,
    sourceAttemptN,
  );
  if (!producerContext && !remoteSession) return { kind: 'missing' };

  const sourceSessionPath = remoteSession
    ? await runtimeSessionStore.hydrateSession({
        attemptN: sourceAttemptN,
        destinationDir: `${stateDirs.piSessionsDir}/remote-${sourceTaskId}-attempt-${sourceAttemptN}`,
        taskId: sourceTaskId,
        teamId,
      })
    : producerContext
      ? resolveProducerSessionPath(producerContext)
      : null;
  if (!sourceSessionPath) return { kind: 'no-session-path' };

  const copiedWorkspaceSource = producerContext
    ? resolveProducerWorkspaceCopySource(producerContext, stateDirs)
    : dirname(dirname(stateDirs.rootDir));

  return {
    kind: 'found',
    producerSlot: producerContext ?? {
      session: null,
      slot: {
        expiresAtMs: 0,
        id: '',
        runtimeProfileId: null,
      },
      workspace: null,
    },
    sessionPath: sourceSessionPath,
    workspacePath: copiedWorkspaceSource,
  };
}

async function maybeAttachWarmSlotContext(
  claimedTask: CachedTask,
  basePlan: DaemonTaskExecutionPlan,
  stateDirs: DaemonStateDirs,
  slotRegistry: RuntimeSlotStore,
  runtimeSessionStore: RuntimeSessionStore,
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
      runtimeSessionStore,
      claimedTask.task.teamId,
      continueFrom.taskId,
      continueFrom.attemptN,
      stateDirs,
    );

    if (resolution.kind === 'missing') {
      throw new ProducerContextResolutionError(
        `Continuation source task ${continueFrom.taskId} attempt ${continueFrom.attemptN} has no live runtime slot on this daemon — claim affinity filter should have prevented this claim`,
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
      // Both the workspace id and the branch name must be unique per fork
      // task: two `fork` continuations of the same parent both run at child
      // attempt 1, so keying the branch only on the parent + attempt would
      // collide (the second `git worktree add` would hit an already-checked-out
      // branch). Include the child task id (mirrors forkWorkspaceId).
      const forkWorkspaceId = `fork-${claimedTask.task.id}-attempt-${claimedTask.attemptN}`;
      const forkBranch = `${parentBranch}-fork-${claimedTask.task.id.slice(0, 8)}-${claimedTask.attemptN}`;
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

    // extend (default): share the parent's branch/workspace. The producer slot
    // has already been resolved and checked against local session state.
    //
    // A null workspace here is legitimate, not a degraded continuation: it
    // means the producer ran in shared_mount (no dedicated worktree), so there
    // is no branch to share and the continuation correctly runs on the shared
    // mount too. Dedicated worktree producers must still resolve to a recorded
    // workspace path before this point.
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
    runtimeSessionStore,
    claimedTask.task.teamId,
    targetTaskId,
    targetAttemptN,
    stateDirs,
  );

  if (resolution.kind === 'missing') {
    throw new ProducerContextResolutionError(
      `No live producer runtime slot found for task ${targetTaskId} attempt ${targetAttemptN}`,
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
  producer: ResolvedRuntimeSlotContext,
): string | null {
  const explicit = producer.session?.sessionPath ?? null;
  if (explicit && existsSync(explicit)) return explicit;

  const sessionDir = producer.session?.sessionDir ?? null;
  if (!sessionDir || !existsSync(sessionDir)) return null;

  const latest = resolveLatestPiSessionPath(sessionDir);
  return latest && existsSync(latest) ? latest : null;
}

function resolveProducerWorkspaceCopySource(
  producer: ResolvedRuntimeSlotContext,
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
  producer: ResolvedRuntimeSlotContext,
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
