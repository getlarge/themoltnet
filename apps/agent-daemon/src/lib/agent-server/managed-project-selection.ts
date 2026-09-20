import { isAbsolute, join } from 'node:path';

import type { Agent } from '@themoltnet/sdk';
import { type ProjectConfig, ProjectConfigError } from '@themoltnet/sdk/node';

import { resolveRunProjectSelection } from '../run-project-selection.js';
import type { RunSpec, RunWorkspace } from './store.js';

type Project = Pick<
  Awaited<ReturnType<Agent['projects']['get']>>,
  'id' | 'teamId' | 'archived' | 'defaultDiaryId'
>;
type Diary = Pick<
  Awaited<ReturnType<Agent['diaries']['get']>>,
  'id' | 'teamId'
>;
export interface ManagedProjectClient {
  projects: { get(id: string, options: { teamId: string }): Promise<Project> };
  diaries: { get(id: string, options: { teamId: string }): Promise<Diary> };
}

/** Resolve against the base store once; the worker receives only this captured config. */
export async function resolveManagedProjectSelection(options: {
  spec: RunSpec;
  root: string;
  cwd: string;
  apiUrl: string;
  client: ManagedProjectClient;
}) {
  const { spec, root, cwd, apiUrl, client } = options;
  if (spec.source !== undefined && !isAbsolute(spec.source))
    throw new ProjectConfigError(
      'selection',
      'Select an absolute source folder',
    );
  if (spec.projectId === null && spec.binding)
    throw new ProjectConfigError(
      'selection',
      'General work cannot also name a binding',
    );
  const selection = await resolveRunProjectSelection({
    agent: spec.agent,
    cwd,
    team: spec.teamId,
    apiUrl,
    'config-file': join(root, 'projects.json'),
    general: !spec.projectId && !spec.binding,
    project: spec.projectId ?? undefined,
    binding: spec.binding,
    source: spec.source,
    'workspace-strategy': spec.workspaceStrategy,
  });
  let diaryId = spec.diaryId ?? selection.binding?.diaryId;
  if (selection.projectId) {
    const project = await client.projects
      .get(selection.projectId, { teamId: spec.teamId })
      .catch(() => {
        throw new ProjectConfigError(
          'selection',
          'The selected project could not be verified. Retry project discovery and team access.',
        );
      });
    if (
      project.id !== selection.projectId ||
      project.teamId !== spec.teamId ||
      project.archived
    )
      throw new ProjectConfigError(
        'selection',
        'The selected project is unavailable to this team',
      );
    diaryId ??= project.defaultDiaryId ?? undefined;
  }
  if (diaryId) {
    const diary = await client.diaries
      .get(diaryId, { teamId: spec.teamId })
      .catch(() => {
        throw new ProjectConfigError(
          'selection',
          'The selected diary could not be verified. Check team access and choose an available diary.',
        );
      });
    if (diary.id !== diaryId || diary.teamId !== spec.teamId)
      throw new ProjectConfigError(
        'selection',
        'The selected diary does not belong to this team',
      );
  }
  const binding = selection.binding
    ? { ...selection.binding, ...(diaryId ? { diaryId } : {}) }
    : undefined;
  const config: ProjectConfig = {
    version: 1,
    bindings: binding ? [binding] : [],
  };
  const workspace: RunWorkspace = {
    projectId: selection.projectId,
    ...(binding ? { binding: binding.name } : {}),
    ...(diaryId ? { diaryId } : {}),
    ...(selection.source ? { source: selection.source } : {}),
    strategy: selection.workspaceExplicit
      ? selection.strategy
      : 'profile-default',
    configPath: selection.configPath,
  };
  return { selection: { ...selection, binding }, workspace, config };
}
