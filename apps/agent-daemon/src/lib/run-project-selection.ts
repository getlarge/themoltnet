import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import type { ResolvedRuntimeProfile } from '@themoltnet/agent-runtime';
import {
  canonicalDirectory,
  getProjectConfigPath,
  type ProjectBinding,
  ProjectConfigError,
  readProjectConfig,
  resolveProjectBinding,
  WORKSPACE_STRATEGIES,
  type WorkspaceStrategy,
} from '@themoltnet/sdk/node';

import { processEnvSnapshot } from '../config.js';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_OUTPUT_BYTES = 64 * 1024;
/** `signal` stops the `git` process; an abort is reported as an abort. */
export async function validateGitSource(
  source: string,
  signal?: AbortSignal,
): Promise<void> {
  const inherited = processEnvSnapshot();
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--show-toplevel', '--verify', 'HEAD^{commit}'],
      {
        cwd: source,
        // Inspect only this checkout; credentials and caller-supplied Git configuration
        // have no role in a local repository precondition check.
        env: {
          PATH: inherited.PATH,
          HOME: inherited.HOME,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
        },
        timeout: GIT_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: GIT_MAX_OUTPUT_BYTES,
        ...(signal ? { signal } : {}),
      },
    );
    const top = stdout.trim().split('\n')[0];
    if ((await canonicalDirectory(top)) === source) return;
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new ProjectConfigError(
      'selection',
      `git-worktree source ${source} requires a Git repository root with a committed revision: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  throw new ProjectConfigError(
    'selection',
    `git-worktree source ${source} must be the Git repository root, not a subdirectory`,
  );
}

export interface PreparationBlocker {
  code: 'unsupported_strategy' | 'hooks_unavailable';
  message: string;
}

/** Hooks that would run commands; an empty `hooks: {}` prepares nothing. */
export function hasPreparationHooks(hooks: ProjectBinding['hooks']): boolean {
  return Boolean(hooks?.afterCreate || hooks?.beforeRun);
}

/**
 * The one rule for whether this runtime can prepare a location. Worker
 * selection, workspace policy and Desktop readiness all call it, so a location
 * Desktop shows as ready is one a worker can start.
 */
export function preparationBlocker(
  strategy: WorkspaceStrategy,
  hooks: ProjectBinding['hooks'],
): PreparationBlocker | null {
  if (strategy === 'isolated-directory')
    return {
      code: 'unsupported_strategy',
      message: 'this runtime does not support isolated-directory preparation',
    };
  if (hasPreparationHooks(hooks))
    return {
      code: 'hooks_unavailable',
      message: 'this runtime does not support project setup hooks',
    };
  return null;
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
  stateRootDir?: string;
  selectedBy: 'explicit' | 'activation' | 'ancestor' | 'general';
  configPath: string;
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
type ProjectRunOptionDefs = ReturnType<typeof projectRunOptionDefs>;
/** Values for the flags `projectRunOptionDefs` parses, keyed by the same names. */
export type ProjectRunFlags = {
  [K in keyof ProjectRunOptionDefs]?: ProjectRunOptionDefs[K]['type'] extends 'boolean'
    ? boolean
    : string;
};

/** Serialize for a worker; the inverse of parsing with `projectRunOptionDefs`. */
export function projectRunArgs(flags: ProjectRunFlags): string[] {
  return Object.entries(flags).flatMap(([name, value]) =>
    value === undefined || value === false
      ? []
      : value === true
        ? [`--${name}`]
        : [`--${name}`, value],
  );
}

function strategy(value: string | undefined): WorkspaceStrategy | undefined {
  if (value === undefined) return undefined;
  if (WORKSPACE_STRATEGIES.includes(value as WorkspaceStrategy))
    return value as WorkspaceStrategy;
  throw new ProjectConfigError(
    'validation',
    `Unknown workspace strategy ${value}; choose ${WORKSPACE_STRATEGIES.join(', ')}`,
  );
}

/** Resolve once at worker startup. No credentials, remote calls, hooks or workspace creation. */
/** Supervisor-only controls; the CLI passes argv values alone. */
export interface RunProjectSelectionOptions {
  /** Bounds the `git` readiness check. */
  signal?: AbortSignal;
  /** Sees the resolved folder, from the request or a location, before `git` runs in it. */
  guardSource?: (source: string) => void;
}

export async function resolveRunProjectSelection(
  args: RunProjectSelectionArgs,
  options: RunProjectSelectionOptions = {},
): Promise<EffectiveRunProjectSelection> {
  const env = processEnvSnapshot();
  const inherited = env.MOLTNET_ACTIVE_IDENTITY === args.agent && !args.general;
  const bindingName =
    args.binding ??
    (!args['config-file'] && !args.project && inherited
      ? env.MOLTNET_PROJECT_BINDING
      : undefined);
  const projectId =
    args.project ??
    (!args['config-file'] && !args.binding && inherited
      ? env.MOLTNET_PROJECT_ID
      : undefined);
  const configPath = resolve(
    args.cwd,
    args['config-file'] ??
      (inherited ? env.MOLTNET_PROJECT_CONFIG : undefined) ??
      getProjectConfigPath(),
  );
  if (args.general && (args.project || args.binding))
    throw new ProjectConfigError(
      'selection',
      'General work cannot also declare a project or binding',
    );
  const overrideStrategy = strategy(args['workspace-strategy']);
  const stateRootDir = args['state-dir']
    ? resolve(args.cwd, args['state-dir'])
    : undefined;
  let binding: ProjectBinding | null = null;
  if (!args.general) {
    try {
      binding = await resolveProjectBinding(
        await readProjectConfig(configPath),
        {
          configPath,
          cwd: args.cwd,
          binding: bindingName,
          projectId,
          native: !bindingName && !projectId,
          teamId: args.team,
          apiUrl: args.apiUrl || undefined,
          overrides: {
            ...(args.source === undefined ? {} : { source: args.source }),
            ...(overrideStrategy === undefined
              ? {}
              : { strategy: overrideStrategy }),
          },
        },
      );
      if (!binding && (bindingName || projectId))
        throw new ProjectConfigError(
          'selection',
          `No matching project binding ${bindingName ?? projectId} in ${configPath} for endpoint ${args.apiUrl ?? '(unspecified)'}; run moltnet projects setup or select --binding/--general`,
        );
    } catch (cause) {
      throw new ProjectConfigError(
        cause instanceof ProjectConfigError ? cause.kind : 'selection',
        `Project selection in ${configPath} (binding ${bindingName ?? projectId ?? 'ancestor'}, endpoint ${args.apiUrl ?? 'unspecified'}): ${cause instanceof Error ? cause.message : String(cause)}. Use moltnet projects setup to register a folder, or select --binding/--general.`,
        { cause },
      );
    }
  }
  const workspaceStrategy = binding?.strategy ?? overrideStrategy ?? 'existing';
  if (workspaceStrategy === 'none' && args.source !== undefined)
    throw new ProjectConfigError(
      'selection',
      'No-workspace execution cannot specify a source',
    );
  let source = binding?.source;
  if (workspaceStrategy !== 'none' && !source) {
    source = await canonicalDirectory(resolve(args.cwd, args.source ?? '.'));
  }
  const blocker = preparationBlocker(workspaceStrategy, binding?.hooks);
  if (blocker) {
    throw new ProjectConfigError(
      'selection',
      `Binding ${binding?.name ?? '(run override)'} in ${configPath}: ${blocker.message}; choose a supported binding`,
    );
  }
  // Only folders a location or the caller chose; the default is the run's own.
  if (source && (binding || args.source !== undefined))
    options.guardSource?.(source);
  if (workspaceStrategy === 'git-worktree' && source) {
    await validateGitSource(source, options.signal);
  }
  return {
    configPath,
    selectedBy:
      args.binding || args.project
        ? 'explicit'
        : bindingName
          ? 'activation'
          : binding
            ? 'ancestor'
            : 'general',
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
  const blocker = preparationBlocker(
    selection.strategy,
    selection.binding?.hooks,
  );
  if (blocker) throw new Error(`Workspace preparation: ${blocker.message}`);
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

export const PROJECT_RUN_FLAGS = `  --binding <name>            Select a saved local project location.
  --project <uuid>            Select a project and its unambiguous binding.
  --general                   Serve General work (projectId: null).
  --config-file <path>        Explicit project bindings JSON.
  --source <path>             Run-only source folder override.
  --workspace-strategy <name> existing, git-worktree, none; isolated-directory
                              is reserved and currently unsupported.
  --state-dir <path>          Supervisor/session state, separate from source.
                              Default: profile mount root (existing state retained).`;
