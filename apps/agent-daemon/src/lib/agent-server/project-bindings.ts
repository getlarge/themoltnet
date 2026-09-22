import { isAbsolute, resolve } from 'node:path';

import {
  canonicalDirectory,
  getProjectConfigPath,
  normalizeProjectEndpoint,
  type ProjectBinding,
  ProjectConfigError,
  readProjectConfig,
  resolveStoreRoot,
  updateProjectConfig,
  validateProjectConfig,
} from '@themoltnet/sdk/node';

import {
  hasPreparationHooks,
  preparationBlocker,
  validateGitSource,
} from '../run-project-selection.js';
import { AgentServerHttpError } from './http-error.js';

export interface LocationReadiness {
  ready: boolean;
  code?: string;
  message?: string;
}

export interface LocalProjectLocation extends ProjectBinding {
  effectiveSource: string | null;
  readiness: LocationReadiness;
}

/** Each check may spawn `git`; bound how many run at once. */
const READINESS_CONCURRENCY = 4;

const PREPARATION_COPY = {
  unsupported_strategy:
    'Isolated directory preparation is unavailable. Choose Work here or a Git worktree.',
  hooks_unavailable:
    'Preparation hooks are unavailable. Remove the hooks or choose another location.',
} as const;

/** Normalize with the Go-compatible grammar, reporting a rejection as a coded error. */
export function locationEndpoint(value: string): string {
  try {
    return normalizeProjectEndpoint(value);
  } catch {
    throw new AgentServerHttpError(
      400,
      'endpoint_unsupported',
      'Local project locations need an HTTPS server endpoint; HTTP is allowed only on loopback',
    );
  }
}

/** Machine registrations live at the base store, outside connection directories. */
export class LocalProjectBindings {
  readonly root: string;
  readonly path: string;
  readonly apiUrl: string;

  constructor(root: string, apiUrl: string) {
    this.root = resolveStoreRoot({ root });
    // The same derivation workers use once they inherit MOLTNET_HOME=root.
    this.path = getProjectConfigPath({ root: this.root });
    this.apiUrl = locationEndpoint(apiUrl);
  }

  async list(): Promise<LocalProjectLocation[]> {
    const config = await readProjectConfig(this.path);
    const bindings = config.bindings.filter(
      (binding) => normalizeProjectEndpoint(binding.apiUrl) === this.apiUrl,
    );
    const locations: LocalProjectLocation[] = [];
    for (let i = 0; i < bindings.length; i += READINESS_CONCURRENCY)
      locations.push(
        ...(await Promise.all(
          bindings
            .slice(i, i + READINESS_CONCURRENCY)
            .map((binding) => this.describe(binding)),
        )),
      );
    return locations;
  }

  async save(value: ProjectBinding): Promise<LocalProjectLocation> {
    const input = structuredClone(value);
    validateProjectConfig({ version: 1, bindings: [input] });
    if (locationEndpoint(input.apiUrl) !== this.apiUrl)
      throw new AgentServerHttpError(
        400,
        'endpoint_mismatch',
        'Location belongs to another endpoint',
      );
    if (input.source && !isAbsolute(input.source))
      throw new ProjectConfigError(
        'validation',
        'Select an absolute source folder',
      );
    const location = await this.describe(input);
    if (!location.readiness.ready)
      throw new AgentServerHttpError(
        400,
        location.readiness.code ?? 'location_unavailable',
        location.readiness.message ?? 'Location is unavailable',
      );
    const binding: ProjectBinding = {
      ...input,
      apiUrl: this.apiUrl,
      ...(location.effectiveSource ? { source: location.effectiveSource } : {}),
    };
    await updateProjectConfig(this.path, (config) => {
      const index = config.bindings.findIndex(
        (entry) => entry.name === binding.name,
      );
      const previous = config.bindings[index];
      if (previous && normalizeProjectEndpoint(previous.apiUrl) !== this.apiUrl)
        throw conflict('This name belongs to another endpoint');
      if (previous && hasPreparationHooks(previous.hooks))
        throw conflict(
          'Remove preparation hooks from the configuration before editing this location',
        );
      if (
        previous &&
        (previous.teamId !== binding.teamId ||
          previous.projectId !== binding.projectId)
      )
        throw conflict('This name belongs to another project');
      if (binding.default) {
        for (const entry of config.bindings) {
          if (
            normalizeProjectEndpoint(entry.apiUrl) === this.apiUrl &&
            entry.teamId === binding.teamId &&
            entry.projectId === binding.projectId
          )
            entry.default = false;
        }
      }
      if (index < 0) config.bindings.push(binding);
      else config.bindings[index] = binding;
    });
    return this.describe(binding);
  }

  async remove(name: string): Promise<void> {
    await updateProjectConfig(this.path, (config) => {
      const index = config.bindings.findIndex(
        (entry) =>
          entry.name === name &&
          normalizeProjectEndpoint(entry.apiUrl) === this.apiUrl,
      );
      if (index < 0)
        throw new AgentServerHttpError(
          404,
          'location_not_found',
          'Location not found',
        );
      config.bindings.splice(index, 1);
    });
  }

  private async describe(
    binding: ProjectBinding,
  ): Promise<LocalProjectLocation> {
    const { effectiveSource, readiness } = await this.readiness(binding);
    return { ...binding, effectiveSource, readiness };
  }

  private async readiness(binding: ProjectBinding): Promise<{
    effectiveSource: string | null;
    readiness: LocationReadiness;
  }> {
    const declared = binding.source ? resolve(this.root, binding.source) : null;
    const unavailable = (
      code: string,
      message: string,
      effectiveSource = declared,
    ) => ({ effectiveSource, readiness: { ready: false, code, message } });
    const blocker = preparationBlocker(binding.strategy, binding.hooks);
    if (blocker)
      return unavailable(blocker.code, PREPARATION_COPY[blocker.code]);
    if (binding.strategy === 'none')
      return { effectiveSource: declared, readiness: { ready: true } };
    if (!declared)
      return unavailable('folder_missing', 'Choose an existing source folder.');
    let source: string;
    try {
      source = await canonicalDirectory(declared);
    } catch {
      return unavailable(
        'folder_missing',
        'The source folder is unavailable. Choose an existing folder.',
      );
    }
    if (binding.strategy === 'git-worktree') {
      try {
        await validateGitSource(source);
      } catch {
        return unavailable(
          'git_unavailable',
          'Choose a Git repository root with a committed revision, or choose Work here.',
          source,
        );
      }
    }
    return { effectiveSource: source, readiness: { ready: true } };
  }
}

function conflict(message: string): AgentServerHttpError {
  return new AgentServerHttpError(409, 'location_conflict', message);
}
