import type { Project } from '@moltnet/database';
import { describe, expect, it, vi } from 'vitest';

import { resolveTaskProject } from './task-project.js';

function fixtures(parentProject: string | null = 'project') {
  return {
    resolveTask: vi
      .fn()
      .mockResolvedValue({ teamId: 'team', projectId: parentProject }),
    projectRepository: {
      findById: vi
        .fn()
        .mockResolvedValue({ teamId: 'team', archived: false } as Project),
    },
  };
}

describe('task project selection', () => {
  it.each([null, 'project'])(
    'inherits parent project %s when no override is supplied',
    async (projectId) => {
      const repos = fixtures(projectId);
      await expect(
        resolveTaskProject(
          { teamId: 'team', continuationTaskId: 'parent' },
          repos,
        ),
      ).resolves.toBe(projectId);
      expect(repos.resolveTask).toHaveBeenCalledWith('parent');
    },
  );
  it('rejects an explicit General override of a project continuation', async () => {
    await expect(
      resolveTaskProject(
        { teamId: 'team', projectId: null, continuationTaskId: 'parent' },
        fixtures(),
      ),
    ).rejects.toMatchObject({
      code: 'invalid',
      message: 'Continuation project must match its parent',
    });
  });
  it('rejects a parent outside the selected team', async () => {
    const repos = fixtures();
    repos.resolveTask.mockResolvedValue(null);
    await expect(
      resolveTaskProject(
        { teamId: 'team', continuationTaskId: 'parent' },
        repos,
      ),
    ).rejects.toMatchObject({
      code: 'invalid',
      message: 'Continuation parent task not found in this team',
      validationErrors: [
        {
          field: 'input/continueFrom/taskId',
          code: 'freeform.sourceTaskNotFound',
          message: 'Source task parent does not resolve to a task you can read',
        },
      ],
    });
  });
  it('permits existing continuations in archived projects but rejects new work', async () => {
    const repos = fixtures();
    repos.projectRepository.findById.mockResolvedValue({
      teamId: 'team',
      archived: true,
    });
    await expect(
      resolveTaskProject(
        { teamId: 'team', continuationTaskId: 'parent' },
        repos,
      ),
    ).resolves.toBe('project');
    await expect(
      resolveTaskProject({ teamId: 'team', projectId: 'project' }, repos),
    ).rejects.toMatchObject({ code: 'invalid' });
  });
  it.each([null, { teamId: 'other', archived: false }])(
    'rejects unavailable or foreign projects',
    async (project) => {
      const repos = fixtures();
      repos.projectRepository.findById.mockResolvedValue(project);
      await expect(
        resolveTaskProject({ teamId: 'team', projectId: 'project' }, repos),
      ).rejects.toMatchObject({
        code: 'invalid',
        message: 'Project must belong to the task team',
      });
    },
  );
});
