import type { ClaimedTask } from '@themoltnet/agent-runtime';

import type { DaemonSlotIdentity } from './daemon-slot-registry.js';
import {
  deriveTaskSessionDescriptor,
  type TaskSessionDescriptor,
} from './session-policy.js';
import { slugifyAsciiLower } from './slugify.js';
import type { DaemonStateDirs } from './state-dir.js';

export type { DaemonSlotIdentity } from './daemon-slot-registry.js';

export interface DaemonTaskExecutionPlan {
  descriptor: TaskSessionDescriptor;
  slotKey: string | null;
  slotId: string | null;
  workspaceId: string | null;
  worktreeBranch: string | null;
  sessionKey: string | null;
  workspaceScope: 'attempt' | 'session';
  sessionPersistence?: { sessionDir: string } | null;
}

export function buildDaemonTaskExecutionPlan(
  task: Pick<
    ClaimedTask['task'],
    'id' | 'taskType' | 'correlationId' | 'input'
  >,
  stateDirs: DaemonStateDirs,
  identity: DaemonSlotIdentity,
  warmSessionTtlSec: number,
): DaemonTaskExecutionPlan {
  const descriptor = deriveTaskSessionDescriptor(task);
  const slotKey = warmSessionTtlSec > 0 ? descriptor.sessionKey : null;
  const workspaceScope =
    slotKey !== null ? descriptor.policy.workspaceScope : 'attempt';
  const slotId = slotKey ? buildDaemonSlotId(identity, slotKey) : null;
  const sessionDir = slotId
    ? `${stateDirs.piSessionsDir}/${encodeURIComponent(slotId)}`
    : null;
  const worktreeBranch = resolveTaskWorktreeBranch(task, descriptor.policy);
  const workspaceId =
    worktreeBranch !== null
      ? resolveTaskWorkspaceId(task, {
          sessionKey: slotId,
          workspaceScope,
          sessionPersistence: sessionDir ? { sessionDir } : null,
        })
      : null;

  return {
    descriptor,
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
    'taskType' | 'correlationId' | 'id' | 'input'
  >,
  policy: { workspaceMode: 'shared_mount' | 'dedicated_worktree' },
): string | null {
  if (policy.workspaceMode !== 'dedicated_worktree') {
    return null;
  }

  if (task.taskType === 'fulfill_brief') {
    const input = task.input as {
      brief?: unknown;
      title?: unknown;
      scopeHint?: unknown;
    };
    const title =
      typeof input.title === 'string' && input.title.trim().length > 0
        ? input.title
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
