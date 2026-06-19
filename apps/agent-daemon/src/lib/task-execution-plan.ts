import type { DaemonSlotIdentity } from '@themoltnet/agent-daemon-state';
import type { ClaimedTask } from '@themoltnet/agent-runtime';

import {
  deriveTaskSessionDescriptor,
  type TaskSessionDescriptor,
} from './session-policy.js';
import { slugifyAsciiLower } from './slugify.js';
import type { DaemonStateDirs } from './state-dir.js';

export interface DaemonTaskExecutionPlan {
  descriptor: TaskSessionDescriptor;
  workspaceMode: 'shared_mount' | 'dedicated_worktree' | 'scratch_mount';
  slotKey: string | null;
  slotId: string | null;
  workspaceId: string | null;
  worktreeBranch: string | null;
  /**
   * Base ref a NEW `worktreeBranch` is cut from (fork continuations branch from
   * the parent tip). Ignored when the branch already exists.
   */
  worktreeBaseRef?: string | null;
  /**
   * Lifecycle kind for the recorded workspace: 'origin' (default worktree),
   * 'fork' (diverged branch), or 'scratch' (copied scratch dir).
   */
  workspaceKind?: 'origin' | 'fork' | 'scratch';
  sessionKey: string | null;
  workspaceScope: 'attempt' | 'session';
  workspaceAttachment?: {
    mountPath: string;
    cwdPath: string;
    shadowWrites?: 'deny' | 'tmpfs';
  } | null;
  workspaceSeed?: {
    copyFromPath: string;
    source: 'producer';
  } | null;
  sessionPersistence?: {
    sessionDir: string;
    forkFromSessionPath?: string | null;
  } | null;
}

export function buildDaemonTaskExecutionPlan(
  task: Pick<
    ClaimedTask['task'],
    'id' | 'taskType' | 'title' | 'correlationId' | 'input'
  >,
  stateDirs: DaemonStateDirs,
  identity: DaemonSlotIdentity,
  warmSessionTtlSec: number,
): DaemonTaskExecutionPlan {
  const descriptor = deriveTaskSessionDescriptor(task);
  const workspaceMode = resolveTaskWorkspaceMode(task, descriptor.policy);
  const slotKey = warmSessionTtlSec > 0 ? descriptor.sessionKey : null;
  const workspaceScope =
    slotKey !== null ? descriptor.policy.workspaceScope : 'attempt';
  const slotId = slotKey ? buildDaemonSlotId(identity, slotKey) : null;
  const sessionDir = slotId
    ? `${stateDirs.piSessionsDir}/${encodeURIComponent(slotId)}`
    : null;
  const worktreeBranch = resolveTaskWorktreeBranch(task, workspaceMode);
  const workspaceId =
    workspaceMode !== 'shared_mount'
      ? resolveTaskWorkspaceId(task, {
          sessionKey: slotId,
          workspaceScope,
          sessionPersistence: sessionDir ? { sessionDir } : null,
        })
      : null;

  return {
    descriptor,
    workspaceMode,
    sessionKey: slotId,
    slotKey,
    slotId,
    workspaceScope,
    sessionPersistence: sessionDir ? { sessionDir } : null,
    workspaceId,
    worktreeBranch,
  };
}

export function buildDaemonSlotId(
  identity: DaemonSlotIdentity,
  slotKey: string,
): string {
  return [
    'agent',
    slugSlotIdentityComponent(identity.agentName),
    'provider',
    slugSlotIdentityComponent(identity.provider),
    'model',
    slugSlotIdentityComponent(identity.model),
    'key',
    slotKey,
  ].join(':');
}

function slugSlotIdentityComponent(input: string): string {
  return slugifyAsciiLower(input.trim(), 64, ['.', '_', '-']);
}

function resolveTaskWorktreeBranch(
  task: Pick<
    ClaimedTask['task'],
    'taskType' | 'title' | 'correlationId' | 'id' | 'input'
  >,
  workspaceMode: 'shared_mount' | 'dedicated_worktree' | 'scratch_mount',
): string | null {
  if (workspaceMode !== 'dedicated_worktree') {
    return null;
  }

  if (task.taskType === 'fulfill_brief') {
    const input = task.input as {
      brief?: unknown;
      scopeHint?: unknown;
    };
    const title =
      typeof task.title === 'string' && task.title.trim().length > 0
        ? task.title
        : typeof input.brief === 'string' && input.brief.trim().length > 0
          ? input.brief
          : task.taskType;
    const slug = slugifyAsciiLower(title, 60) || 'task';

    if (task.correlationId) {
      return `moltnet/${task.correlationId}/${slug}`;
    }

    const scopeHint =
      typeof input.scopeHint === 'string' && input.scopeHint.trim().length > 0
        ? slugifyAsciiLower(input.scopeHint, 60)
        : 'task';
    return `feat/${scopeHint || 'task'}-${slug}`;
  }

  return `task/${slugifyAsciiLower(task.taskType, 60) || 'task'}-${task.id.slice(0, 8)}`;
}

function resolveTaskWorkspaceMode(
  task: Pick<ClaimedTask['task'], 'taskType' | 'input'>,
  policy: {
    workspaceMode: 'shared_mount' | 'dedicated_worktree';
    acceptsInputWorkspaceOverride: boolean;
  },
): 'shared_mount' | 'dedicated_worktree' | 'scratch_mount' {
  if (!policy.acceptsInputWorkspaceOverride) {
    return policy.workspaceMode;
  }

  const requestedWorkspace =
    typeof (
      task.input as {
        execution?: { workspace?: unknown };
      }
    ).execution?.workspace === 'string'
      ? (task.input as { execution: { workspace: string } }).execution.workspace
      : null;

  switch (requestedWorkspace) {
    case 'none':
      return 'scratch_mount';
    case 'shared_mount':
      return 'shared_mount';
    case 'dedicated_worktree':
      return 'dedicated_worktree';
    default:
      return policy.workspaceMode;
  }
}

function resolveTaskWorkspaceId(
  task: Pick<ClaimedTask['task'], 'id'>,
  executionPlan: {
    sessionKey: string | null;
    workspaceScope: 'attempt' | 'session';
    sessionPersistence?: { sessionDir: string } | null;
  },
): string {
  if (
    executionPlan.workspaceScope === 'session' &&
    executionPlan.sessionKey !== null
  ) {
    return `session-${encodeURIComponent(executionPlan.sessionKey)}`;
  }
  return `task-${task.id}`;
}
