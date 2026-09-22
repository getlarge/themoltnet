import { isAbsolute } from 'node:path';

import type { Agent } from '@themoltnet/sdk';
import {
  canonicalDirectory,
  getProjectConfigPath,
  type ProjectConfig,
  ProjectConfigError,
} from '@themoltnet/sdk/node';

import { resolveRunProjectSelection } from '../run-project-selection.js';
import {
  type ProjectCheckLogger,
  verifyProjectTarget,
  visibleOrNull,
} from './project-target.js';
import {
  isProtectedFolder,
  PROTECTED_FOLDER_MESSAGE,
} from './protected-roots.js';
import {
  PROFILE_DEFAULT_STRATEGY,
  type RunSpec,
  type RunWorkspace,
} from './store.js';

type Project = Pick<
  Awaited<ReturnType<Agent['projects']['get']>>,
  'id' | 'teamId' | 'name' | 'description' | 'archived' | 'defaultDiaryId'
>;
type Diary = Pick<
  Awaited<ReturnType<Agent['diaries']['get']>>,
  'id' | 'teamId'
>;
export interface ManagedProjectClient {
  projects: { get(id: string, options: { teamId: string }): Promise<Project> };
  diaries: { get(id: string, options: { teamId: string }): Promise<Diary> };
}

/** True when the start request names any project selection field. */
export function requestsProjectSelection(spec: RunSpec): boolean {
  return (
    spec.projectId !== undefined ||
    spec.location !== undefined ||
    spec.source !== undefined ||
    spec.strategy !== undefined
  );
}

/**
 * Resolve against the base store once; the worker receives only this captured
 * config. The request in `spec` is never modified: resolved values are
 * returned in `workspace` and `effective`, so a run can be replayed from what
 * the caller asked for.
 */
export async function resolveManagedProjectSelection(options: {
  spec: RunSpec;
  root: string;
  cwd: string;
  apiUrl: string;
  client: ManagedProjectClient;
  /** Directories a worker must never run in or above (store, secrets). */
  protectedRoots: string[];
  /**
   * The team default diary for General work when none was requested. Kept out
   * of the request, so Run again follows the default as it is then.
   */
  generalDefaultDiary?: () => Promise<string | undefined>;
  signal: AbortSignal;
  logger?: ProjectCheckLogger;
}) {
  const { spec, root, cwd, apiUrl, client, signal } = options;
  if (spec.source !== undefined) {
    if (!isAbsolute(spec.source))
      throw new ProjectConfigError(
        'selection',
        'Select an absolute source folder',
      );
    let canonical: string;
    try {
      canonical = await canonicalDirectory(spec.source);
    } catch (cause) {
      throw new ProjectConfigError(
        'selection',
        'The selected folder is unavailable. Choose an existing folder.',
        { cause },
      );
    }
    // Before resolution, which may run `git` in the folder.
    assertOutsideProtected(canonical, options.protectedRoots);
  }
  if (spec.projectId === null && spec.location)
    throw new ProjectConfigError(
      'selection',
      'General work cannot also name a location',
    );
  const selection = await resolveRunProjectSelection(
    {
      agent: spec.agent,
      cwd,
      team: spec.teamId,
      apiUrl,
      // The file Desktop writes and workers inherit through MOLTNET_HOME.
      'config-file': getProjectConfigPath({ root }),
      general: !spec.projectId && !spec.location,
      project: spec.projectId ?? undefined,
      binding: spec.location,
      source: spec.source,
      'workspace-strategy': spec.strategy,
    },
    {
      signal,
      // A location's saved folder is only known here; check it before `git`.
      guardSource: (source) =>
        assertOutsideProtected(source, options.protectedRoots),
    },
  );
  const chosenSource = selection.workspaceExplicit
    ? selection.source
    : undefined;
  const reader = {
    readProject: (
      teamId: string,
      projectId: string,
      readSignal: AbortSignal,
    ) => {
      readSignal.throwIfAborted();
      return visibleOrNull(() => client.projects.get(projectId, { teamId }));
    },
    readDiary: (teamId: string, diaryId: string, readSignal: AbortSignal) => {
      readSignal.throwIfAborted();
      return visibleOrNull(() => client.diaries.get(diaryId, { teamId }));
    },
  };
  const check = {
    signal,
    ...(options.logger ? { logger: options.logger } : {}),
  };
  const { project } = await verifyProjectTarget(
    reader,
    { teamId: spec.teamId, projectId: selection.projectId },
    check,
  );
  // An explicit or location diary wins; the project's default is the fallback.
  const diaryId =
    spec.diaryId ??
    selection.binding?.diaryId ??
    project?.defaultDiaryId ??
    (selection.projectId === null
      ? await options.generalDefaultDiary?.()
      : undefined) ??
    undefined;
  if (diaryId)
    await verifyProjectTarget(
      reader,
      { teamId: spec.teamId, projectId: null, diaryId },
      check,
    );
  const resolvedBinding = selection.binding
    ? { ...selection.binding, ...(diaryId ? { diaryId } : {}) }
    : undefined;
  const config: ProjectConfig = {
    version: 1,
    bindings: resolvedBinding ? [resolvedBinding] : [],
  };
  const workspace: Omit<RunWorkspace, 'configPath'> = {
    projectId: selection.projectId,
    ...(resolvedBinding ? { location: resolvedBinding.name } : {}),
    ...(diaryId ? { diaryId } : {}),
    ...(chosenSource ? { source: chosenSource } : {}),
    strategy: selection.workspaceExplicit
      ? selection.strategy
      : PROFILE_DEFAULT_STRATEGY,
  };
  return {
    selection: { ...selection, binding: resolvedBinding },
    workspace,
    config,
    /** The spec with resolved ids, for the worker environment only. */
    effective: {
      ...spec,
      projectId: selection.projectId,
      ...(diaryId ? { diaryId } : {}),
    },
  };
}

function assertOutsideProtected(source: string, roots: string[]): void {
  if (isProtectedFolder(source, roots))
    throw new ProjectConfigError('selection', PROTECTED_FOLDER_MESSAGE);
}
