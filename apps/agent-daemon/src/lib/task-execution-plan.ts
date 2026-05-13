import { join } from 'node:path';

import type { ClaimedTask } from '@themoltnet/agent-runtime';
import type { PiTaskExecutionPlan } from '@themoltnet/pi-extension';

import {
  deriveTaskSessionDescriptor,
  type TaskSessionDescriptor,
} from './session-policy.js';
import type { DaemonStateDirs } from './state-dir.js';

export interface DaemonTaskExecutionPlan extends PiTaskExecutionPlan {
  descriptor: TaskSessionDescriptor;
}

export function buildDaemonTaskExecutionPlan(
  task: Pick<
    ClaimedTask['task'],
    'id' | 'taskType' | 'correlationId' | 'input'
  >,
  stateDirs: DaemonStateDirs,
): DaemonTaskExecutionPlan {
  const descriptor = deriveTaskSessionDescriptor(task);
  const sessionDir = descriptor.sessionKey
    ? join(stateDirs.piSessionsDir, encodeURIComponent(descriptor.sessionKey))
    : null;

  return {
    descriptor,
    sessionKey: descriptor.sessionKey,
    workspaceScope: descriptor.policy.workspaceScope,
    sessionPersistence: sessionDir ? { sessionDir } : null,
  };
}
