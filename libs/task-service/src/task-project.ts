import type { ProjectRepository } from '@moltnet/database';

import { TaskServiceError } from './task-service.shared.js';

/**
 * Resolve association independently of the task-input CID and local workspace.
 * Archive is checked at proposal validation: archiving does not cancel a create
 * already in flight, just as it does not cancel an existing queued task.
 */
export async function resolveTaskProject(
  input: {
    teamId: string;
    projectId?: string | null;
    continuationTaskId?: string;
  },
  repositories: {
    resolveTask: (
      id: string,
    ) => Promise<{ teamId: string; projectId?: string | null } | null>;
    projectRepository: Pick<ProjectRepository, 'findById'>;
  },
): Promise<string | null> {
  let projectId = input.projectId ?? null;
  if (input.continuationTaskId) {
    const parent = await repositories.resolveTask(input.continuationTaskId);
    if (!parent || parent.teamId !== input.teamId)
      throw new TaskServiceError(
        'invalid',
        'Continuation parent task not found in this team',
      );
    if (
      input.projectId !== undefined &&
      input.projectId !== (parent.projectId ?? null)
    ) {
      throw new TaskServiceError(
        'invalid',
        'Continuation project must match its parent',
      );
    }
    projectId = parent.projectId ?? null;
  }
  if (projectId) {
    const project = await repositories.projectRepository.findById(projectId);
    if (!project || project.teamId !== input.teamId)
      throw new TaskServiceError(
        'invalid',
        'Project must belong to the task team',
      );
    if (project.archived && !input.continuationTaskId)
      throw new TaskServiceError(
        'invalid',
        'Project is archived; select an active project for new work',
      );
  }
  return projectId;
}
