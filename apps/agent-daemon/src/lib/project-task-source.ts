import { getTaskExecutionPolicy } from '@moltnet/tasks';
import { ApiTaskSource, PollingApiTaskSource } from '@themoltnet/agent-runtime';

import type { EffectiveRunProjectSelection } from './run-project-selection.js';
import { resolveTaskWorkspaceRevision } from './task-execution-plan.js';

type RunSelection = Pick<
  EffectiveRunProjectSelection,
  'projectId' | 'workspaceExplicit' | 'strategy'
>;
type OnceOptions = Omit<
  ConstructorParameters<typeof ApiTaskSource>[0],
  'projectId'
>;
type PollOptions = Omit<
  ConstructorParameters<typeof PollingApiTaskSource>[0],
  'projectId' | 'isTaskEligible'
>;

// The run owns the project declaration, including an explicit null for General.
// Source options cannot replace it independently of the pinned run selection.
export function createProjectOnceSource(
  selection: RunSelection,
  options: OnceOptions,
): ApiTaskSource {
  return new ApiTaskSource({ ...options, projectId: selection.projectId });
}
export function createProjectPollingSource(
  selection: RunSelection,
  options: PollOptions,
): PollingApiTaskSource {
  return new PollingApiTaskSource({
    ...options,
    projectId: selection.projectId,
    isTaskEligible: (task) => {
      if (!selection.workspaceExplicit) return true;
      if (
        resolveTaskWorkspaceRevision(task.input) &&
        selection.strategy !== 'git-worktree'
      )
        return false;
      if (!getTaskExecutionPolicy(task.taskType).acceptsInputWorkspaceOverride)
        return true;
      const requested = (
        task.input as { execution?: { workspace?: string } } | null
      )?.execution?.workspace;
      if (
        !requested ||
        !['none', 'shared_mount', 'dedicated_worktree'].includes(requested)
      )
        return true;
      const mode =
        selection.strategy === 'existing'
          ? 'shared_mount'
          : selection.strategy === 'git-worktree'
            ? 'dedicated_worktree'
            : 'none';
      return requested === mode;
    },
  });
}
