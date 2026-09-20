import { isAbsolute, join, resolve } from 'node:path';

import {
  canonicalDirectory,
  canonicalStoreRoot,
  normalizeProjectEndpoint,
  type ProjectBinding,
  ProjectConfigError,
  readProjectConfig,
  updateProjectConfig,
  validateProjectConfig,
} from '@themoltnet/sdk/node';

import { validateGitSource } from '../run-project-selection.js';

export interface LocalProjectLocation extends ProjectBinding {
  effectiveSource: string | null;
  readiness: { ready: boolean; code?: string; message?: string };
}

/** Machine registrations live at the base store, outside connection directories. */
export class LocalProjectBindings {
  readonly root: string;
  readonly path: string;
  readonly apiUrl: string;

  constructor(root: string, apiUrl: string) {
    this.root = canonicalStoreRoot(root);
    this.path = join(this.root, 'projects.json');
    this.apiUrl = normalizeProjectEndpoint(apiUrl);
  }

  async list(): Promise<LocalProjectLocation[]> {
    const config = await readProjectConfig(this.path);
    return Promise.all(
      config.bindings
        .filter(
          (binding) => normalizeProjectEndpoint(binding.apiUrl) === this.apiUrl,
        )
        .map((binding) => this.describe(binding)),
    );
  }

  async save(value: ProjectBinding): Promise<LocalProjectLocation> {
    const input = structuredClone(value);
    validateProjectConfig({ version: 1, bindings: [input] });
    if (normalizeProjectEndpoint(input.apiUrl) !== this.apiUrl)
      throw new ProjectConfigError(
        'selection',
        'Location belongs to another endpoint',
      );
    if (input.source && !isAbsolute(input.source))
      throw new ProjectConfigError(
        'validation',
        'Select an absolute source folder',
      );
    const location = await this.describe(input);
    if (!location.readiness.ready)
      throw new ProjectConfigError(
        'selection',
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
        throw new ProjectConfigError(
          'selection',
          'This name belongs to another endpoint',
        );
      if (previous?.hooks)
        throw new ProjectConfigError(
          'selection',
          'Remove preparation hooks from the configuration before editing this location',
        );
      if (
        previous &&
        (previous.teamId !== binding.teamId ||
          previous.projectId !== binding.projectId)
      )
        throw new ProjectConfigError(
          'selection',
          'This name belongs to another project',
        );
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
        throw new ProjectConfigError('selection', 'Location not found');
      config.bindings.splice(index, 1);
    });
  }

  private async describe(
    binding: ProjectBinding,
  ): Promise<LocalProjectLocation> {
    const location: LocalProjectLocation = {
      ...binding,
      effectiveSource: binding.source
        ? resolve(this.root, binding.source)
        : null,
      readiness: { ready: true },
    };
    const unavailable = (code: string, message: string) => {
      location.readiness = { ready: false, code, message };
      return location;
    };
    if (binding.strategy === 'isolated-directory')
      return unavailable(
        'unsupported_strategy',
        'Isolated directory preparation is unavailable. Choose Work here or a Git worktree.',
      );
    if (binding.hooks)
      return unavailable(
        'hooks_unavailable',
        'Preparation hooks are unavailable. Remove the hooks or choose another location.',
      );
    if (binding.strategy === 'none') return location;
    const source = location.effectiveSource;
    if (!source)
      return unavailable('folder_missing', 'Choose an existing source folder.');
    try {
      location.effectiveSource = await canonicalDirectory(source);
    } catch {
      return unavailable(
        'folder_missing',
        'The source folder is unavailable. Choose an existing folder.',
      );
    }
    if (binding.strategy === 'git-worktree') {
      try {
        await validateGitSource(location.effectiveSource);
      } catch {
        return unavailable(
          'git_unavailable',
          'Choose a Git repository root with a committed revision, or choose Work here.',
        );
      }
    }
    return location;
  }
}
