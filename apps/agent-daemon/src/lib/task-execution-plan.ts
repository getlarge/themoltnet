import { join } from 'node:path';

import type { ClaimedTask } from '@themoltnet/agent-runtime';
import {
  type PiTaskExecutionPlan,
  resolveTaskWorkspaceId,
  resolveTaskWorktreeBranch,
} from '@themoltnet/pi-extension';

import {
  deriveTaskSessionDescriptor,
  type TaskSessionDescriptor,
} from './session-policy.js';
import type { DaemonStateDirs } from './state-dir.js';

export interface DaemonSlotIdentity {
  agentName: string;
  provider: string;
  model: string;
}

export interface DaemonTaskExecutionPlan extends PiTaskExecutionPlan {
  descriptor: TaskSessionDescriptor;
  slotKey: string | null;
  slotId: string | null;
  workspaceId: string | null;
  worktreeBranch: string | null;
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
    ? join(stateDirs.piSessionsDir, encodeURIComponent(slotId))
    : null;
  const worktreeBranch = resolveTaskWorktreeBranch(task);
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
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');
}
