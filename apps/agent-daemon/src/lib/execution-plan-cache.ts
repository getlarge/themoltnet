import { createHash } from 'node:crypto';

import type { ClaimedTask } from '@themoltnet/agent-runtime';

import type { DaemonSlotIdentity } from './daemon-slot-identity.js';
import {
  buildDaemonSlotId,
  buildDaemonTaskExecutionPlan,
  buildRuntimeSlotKey,
  type DaemonTaskExecutionPlan,
  type RuntimeProfileWorkspacePolicy,
  WorkspaceModeMismatchError,
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

export interface ListedRuntimeSlotContext {
  slot: {
    id: string;
    expiresAtMs: number;
    lastAttemptN: number;
    lastTaskId: string;
    runtimeProfileId: string | null;
    slotKey: string;
    state: 'active' | 'idle';
    taskType: string;
  };
  session: ResolvedRuntimeSlotContext['session'];
  workspace: ResolvedRuntimeSlotContext['workspace'];
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
    warmRetentionSec: number;
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
    warmRetentionSec: number,
  ): Promise<void>;
  findLatestSlotByTaskAttempt(
    teamId: string,
    taskId: string,
    attemptN: number,
  ): Promise<ResolvedRuntimeSlotContext | null>;
  listSlots(input: {
    agentName?: string;
    limit?: number;
    runtimeProfileId?: string;
    state?: 'active' | 'idle';
    teamId: string;
  }): Promise<ListedRuntimeSlotContext[]>;
  close(): Promise<void>;
}

export interface SourceAttemptResolver {
  findOutputBranch(input: {
    teamId: string;
    taskId: string;
    attemptN: number;
  }): Promise<string | null>;
  findInputRevision(input: {
    teamId: string;
    taskId: string;
    attemptN: number;
  }): Promise<string | null>;
}

type CachedTask = Pick<ClaimedTask, 'task' | 'attemptN'>;

export interface ExecutionPlanCache {
  getOrCreate(claimedTask: CachedTask): Promise<DaemonTaskExecutionPlan>;
  delete(claimedTask: CachedTask): void;
}

/** Plans environments only. Pi Durable owns all conversation continuity. */
export function createExecutionPlanCache(args: {
  slotIdentity: DaemonSlotIdentity;
  workspacePolicy?: RuntimeProfileWorkspacePolicy;
  sourceAttemptResolver?: SourceAttemptResolver;
}): ExecutionPlanCache {
  const cache = new Map<string, DaemonTaskExecutionPlan>();
  return {
    async getOrCreate(claimedTask) {
      const key = buildClaimedTaskKey(claimedTask);
      const existing = cache.get(key);
      if (existing) return existing;
      const plan = buildDaemonTaskExecutionPlan(
        claimedTask.task,
        args.workspacePolicy,
        claimedTask.attemptN,
      );
      const input = claimedTask.task.input as {
        targetTaskId?: string;
        targetAttemptN?: number;
      };
      const parent =
        claimedTask.task.taskType === 'judge_eval_attempt' &&
        input.targetTaskId &&
        input.targetAttemptN
          ? {
              taskId: input.targetTaskId,
              attemptN: input.targetAttemptN,
              mode: 'fork',
            }
          : (
              claimedTask.task.input as {
                continueFrom?: {
                  taskId: string;
                  attemptN: number;
                  mode?: string;
                };
              }
            ).continueFrom;
      if (parent && args.sourceAttemptResolver) {
        const source = {
          teamId: claimedTask.task.teamId,
          taskId: parent.taskId,
          attemptN: parent.attemptN,
        };
        const branch =
          await args.sourceAttemptResolver.findOutputBranch(source);
        const revision = branch
          ? null
          : await args.sourceAttemptResolver.findInputRevision(source);
        if (branch || revision) {
          plan.workspaceMode = 'dedicated_worktree';
          if (parent.mode === 'fork') {
            plan.workspaceKind = 'fork';
            plan.worktreeBaseRef = branch ?? revision;
            plan.worktreeBranch = `${branch ?? 'durable'}-fork-${claimedTask.task.id.slice(0, 8)}-${claimedTask.attemptN}`;
            plan.workspaceRevision = null;
          } else {
            plan.worktreeBranch = branch;
            plan.workspaceRevision = revision;
          }
        }
      }
      // A Git branch has one retained checkout. A fork gets a different branch.
      if (plan.worktreeBranch)
        plan.workspaceId = `durable-branch-${createHash('sha256').update(`${claimedTask.task.teamId}:${plan.worktreeBranch}`).digest('hex').slice(0, 32)}`;
      plan.workspaceScope = 'session';
      plan.sessionKey = `durable:${claimedTask.task.id}:${claimedTask.attemptN}`;
      if (plan.workspaceId && plan.workspaceMode !== 'shared_mount') {
        plan.slotKey = buildRuntimeSlotKey(
          `workspace:${plan.workspaceId}`,
          args.slotIdentity.runtimeInstanceId,
        );
        plan.slotId = buildDaemonSlotId(args.slotIdentity, plan.slotKey);
      }
      assertPlanAllowedByWorkspacePolicy(
        plan,
        args.workspacePolicy,
        args.slotIdentity.runtimeProfileId,
      );
      cache.set(key, plan);
      return plan;
    },
    delete(claimedTask) {
      cache.delete(buildClaimedTaskKey(claimedTask));
    },
  };
}

function assertPlanAllowedByWorkspacePolicy(
  plan: DaemonTaskExecutionPlan,
  policy: RuntimeProfileWorkspacePolicy | undefined,
  runtimeProfileId: string,
): void {
  const allowed = new Set(
    policy?.allowedWorkspaceModes && policy.allowedWorkspaceModes.length > 0
      ? policy.allowedWorkspaceModes
      : ['none', 'shared_mount', 'dedicated_worktree'],
  );
  const effectiveMode = planToRuntimeProfileWorkspaceMode(plan);
  // Only a dedicated worktree can check out a pinned revision: the shared
  // mount runs from the base checkout and a scratch mount has no git state.
  // Fail at claim time naming the profile instead of letting the runtime
  // report a misleading git-revision mismatch (#1948).
  if (plan.workspaceRevision && effectiveMode !== 'dedicated_worktree') {
    throw new WorkspaceModeMismatchError(
      `Runtime profile "${runtimeProfileId}" does not allow "dedicated_worktree", required by a revision-pinned task (resolved workspace mode "${effectiveMode}")`,
    );
  }
  if (!allowed.has(effectiveMode)) {
    throw new WorkspaceModeMismatchError(
      `Runtime profile "${policy?.profileName ?? runtimeProfileId}" forbids final workspace mode "${effectiveMode}"; allowed: ${[...allowed].join(', ')}`,
    );
  }
}

function planToRuntimeProfileWorkspaceMode(
  plan: DaemonTaskExecutionPlan,
): 'none' | 'shared_mount' | 'dedicated_worktree' {
  if (plan.workspaceMode === 'scratch_mount') return 'none';
  if (
    plan.workspaceMode === 'dedicated_worktree' &&
    !plan.worktreeBranch &&
    !plan.workspaceRevision
  ) {
    return 'shared_mount';
  }
  return plan.workspaceMode;
}

function buildClaimedTaskKey(task: CachedTask): string {
  return `${task.task.id}:${task.attemptN}`;
}
