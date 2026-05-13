import type { ClaimedTask } from '@themoltnet/agent-runtime';

export interface PiSessionPersistencePlan {
  sessionDir: string;
}

export interface PiTaskExecutionPlan {
  /**
   * Daemon-local reuse key. When set alongside `workspaceScope: 'session'`,
   * dedicated worktrees may be retained and reopened across related tasks.
   */
  sessionKey: string | null;
  /**
   * Lifetime of the task workspace from the daemon's point of view.
   * `attempt` = disposable; `session` = keep stable for the reuse key.
   */
  workspaceScope: 'attempt' | 'session';
  /**
   * Optional location for file-backed Pi session history. When omitted,
   * the executor keeps the conversation in memory for this attempt only.
   */
  sessionPersistence?: PiSessionPersistencePlan | null;
}

export type PiTaskExecutionPlanFactory = (
  claimedTask: ClaimedTask,
) => PiTaskExecutionPlan | null;
