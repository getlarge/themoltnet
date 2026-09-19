import { execFile } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { ResolvedRuntimeProfile } from '@themoltnet/agent-runtime';
import {
  getProjectConfigPath,
  type ProjectBinding,
  readProjectConfig,
  resolveProjectBinding,
  type WorkspaceStrategy,
} from '@themoltnet/sdk/node';

import { processEnvSnapshot } from '../config.js';

const execFileAsync = promisify(execFile);

async function validateGitSource(source: string): Promise<void> {
  const env = { ...processEnvSnapshot() };
  // Git must inspect the selected source, even when launched from a Git hook.
  for (const key of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_COMMON_DIR',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  ])
    delete env[key];
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--is-inside-work-tree'],
      {
        cwd: source,
        env,
        timeout: 10_000,
        maxBuffer: 64 * 1024,
      },
    );
    if (stdout.trim() !== 'true') throw new Error('No working tree');
    await execFileAsync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
      cwd: source,
      env,
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    });
  } catch (cause) {
    throw new Error(
      'git-worktree requires an available Git repository with a committed revision',
      { cause },
    );
  }
}

export interface RunProjectSelectionArgs {
  agent: string;
  cwd: string;
  team?: string;
  project?: string;
  binding?: string;
  general?: boolean;
  'config-file'?: string;
  'state-dir'?: string;
  source?: string;
  'workspace-strategy'?: string;
  apiUrl?: string;
}
export interface EffectiveRunProjectSelection {
  projectId: string | null;
  teamId?: string;
  apiUrl?: string;
  binding?: ProjectBinding;
  source?: string;
  strategy: WorkspaceStrategy;
  stateRootDir: string;
  workspaceExplicit: boolean;
}
export function projectRunOptionDefs() {
  return {
    project: { type: 'string' },
    binding: { type: 'string' },
    general: { type: 'boolean' },
    'config-file': { type: 'string' },
    'state-dir': { type: 'string' },
    source: { type: 'string' },
    'workspace-strategy': { type: 'string' },
  } as const;
}
function strategy(value: string | undefined): WorkspaceStrategy | undefined {
  if (value === undefined) return undefined;
  if (
    value === 'none' ||
    value === 'existing' ||
    value === 'git-worktree' ||
    value === 'isolated-directory'
  )
    return value;
  throw new Error(
    'Unknown workspace strategy; choose existing, git-worktree, isolated-directory, or none',
  );
}

/** Resolve once at worker startup. No credentials, remote calls, hooks or workspace creation. */
export async function resolveRunProjectSelection(
  args: RunProjectSelectionArgs,
): Promise<EffectiveRunProjectSelection> {
  if (args.general && (args.project || args.binding))
    throw new Error('General work cannot also declare a project or binding');
  const overrideStrategy = strategy(args['workspace-strategy']);
  const stateRootDir = args['state-dir']
    ? resolve(args.cwd, args['state-dir'])
    : join(homedir(), '.config', 'moltnet', 'daemon-state', args.agent);
  let binding: ProjectBinding | null = null;
  if (!args.general && (args.project || args.binding || args['config-file'])) {
    const configPath = args['config-file']
      ? resolve(args.cwd, args['config-file'])
      : getProjectConfigPath();
    binding = await resolveProjectBinding(await readProjectConfig(configPath), {
      configPath,
      cwd: args.cwd,
      binding: args.binding,
      projectId: args.project,
      teamId: args.team,
      apiUrl: args.apiUrl || undefined,
      overrides: {
        ...(args.source === undefined ? {} : { source: args.source }),
        ...(overrideStrategy === undefined
          ? {}
          : { strategy: overrideStrategy }),
      },
    });
    if (!binding)
      throw new Error(
        'No matching project binding; register or select a location',
      );
  }
  const workspaceStrategy = binding?.strategy ?? overrideStrategy ?? 'existing';
  if (workspaceStrategy === 'none' && args.source !== undefined)
    throw new Error('No-workspace execution cannot specify a source');
  let source = binding?.source;
  if (workspaceStrategy !== 'none' && !source) {
    source = await realpath(resolve(args.cwd, args.source ?? '.'));
    if (!(await stat(source)).isDirectory())
      throw new Error('Workspace source must be a directory');
  }
  if (workspaceStrategy === 'git-worktree' && source) {
    await validateGitSource(source);
  }
  return {
    projectId: binding?.projectId ?? null,
    teamId: binding?.teamId ?? args.team,
    apiUrl: binding?.apiUrl ?? (args.apiUrl || undefined),
    ...(binding ? { binding } : {}),
    source,
    strategy: workspaceStrategy,
    stateRootDir,
    workspaceExplicit: Boolean(binding || overrideStrategy || args.source),
  };
}

/** A selected location fixes this worker's strategy; saved profiles are never mutated. */
export function applyProjectWorkspacePolicy(
  profile: ResolvedRuntimeProfile,
  selection: EffectiveRunProjectSelection,
): ResolvedRuntimeProfile {
  if (!selection.workspaceExplicit) return profile;
  if (selection.strategy === 'isolated-directory') {
    throw new Error(
      'This runtime does not yet support isolated-directory preparation',
    );
  }
  if (
    selection.binding?.hooks?.afterCreate ||
    selection.binding?.hooks?.beforeRun
  ) {
    throw new Error('This runtime does not yet support project setup hooks');
  }
  const mode =
    selection.strategy === 'existing'
      ? 'shared_mount'
      : selection.strategy === 'git-worktree'
        ? 'dedicated_worktree'
        : 'none';
  if (
    profile.allowedWorkspaceModes.length &&
    !profile.allowedWorkspaceModes.includes(mode)
  ) {
    throw new Error(
      `Workspace strategy ${selection.strategy} is not allowed by profile ${profile.name}`,
    );
  }
  return {
    ...profile,
    mountPath: selection.source ?? profile.mountPath,
    defaultWorkspaceMode: mode,
    allowedWorkspaceModes: [mode],
  };
}
