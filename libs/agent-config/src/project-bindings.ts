import { randomUUID } from 'node:crypto';
import {
  lstat,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { getConfigDir } from './config.js';
import { withConfigLock } from './config-lock.js';

export type WorkspaceStrategy =
  | 'none'
  | 'existing'
  | 'git-worktree'
  | 'isolated-directory';
export interface WorkspaceHook {
  command: string;
  args: string[];
  timeoutMs: number;
}
export interface ProjectBinding {
  name: string;
  apiUrl: string;
  teamId: string;
  projectId: string;
  diaryId?: string;
  source?: string;
  strategy: WorkspaceStrategy;
  default?: boolean;
  hooks?: { afterCreate?: WorkspaceHook; beforeRun?: WorkspaceHook };
}
export interface ProjectConfig {
  version: 1;
  bindings: ProjectBinding[];
}
export interface ProjectSelectionOptions {
  configPath?: string;
  cwd: string;
  binding?: string;
  apiUrl?: string;
  teamId?: string;
  projectId?: string;
  /** Native activation selects only registered ancestors, never a remote match. */
  native?: boolean;
  overrides?: Partial<Pick<ProjectBinding, 'source' | 'strategy' | 'diaryId'>>;
}

export function getProjectConfigPath(): string {
  return join(getConfigDir(), 'projects.json');
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function fields(
  value: Record<string, unknown>,
  allowed: string[],
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key))
      throw new Error(`Unknown ${label} field: ${key}`);
  }
}
function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0'))
    throw new Error(`${label} must be a non-empty string`);
}
function endpoint(value: string): string {
  const url = new URL(value);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      'apiUrl must be an HTTP(S) endpoint without credentials, query or fragment',
    );
  return url.toString().replace(/\/$/, '');
}

/** Strict versioned local contract. This validates data, never resolves credentials. */
export function validateProjectConfig(
  value: unknown,
): asserts value is ProjectConfig {
  const config = object(value, 'Project config');
  if ('contexts' in config)
    throw new Error(
      'Legacy contexts require migration: explicitly register each checkout path in projects.json',
    );
  if (config.version !== 1)
    throw new Error('Unsupported project config version; expected 1');
  fields(config, ['version', 'bindings'], 'config');
  if (!Array.isArray(config.bindings))
    throw new Error('bindings must be an array');
  const names = new Set<string>();
  const defaults = new Set<string>();
  for (const item of config.bindings) {
    const b = object(item, 'Binding');
    fields(
      b,
      [
        'name',
        'apiUrl',
        'teamId',
        'projectId',
        'diaryId',
        'source',
        'strategy',
        'default',
        'hooks',
      ],
      'binding',
    );
    for (const key of ['name', 'apiUrl', 'teamId', 'projectId'])
      text(b[key], key);
    const name = b.name as string;
    if (names.has(name)) throw new Error(`Duplicate binding name: ${name}`);
    names.add(name);
    const apiUrl = endpoint(b.apiUrl as string);
    if (
      !['none', 'existing', 'git-worktree', 'isolated-directory'].includes(
        b.strategy as string,
      )
    )
      throw new Error('An explicit workspace strategy is required');
    if (b.strategy === 'none') {
      if (b.source !== undefined || b.hooks !== undefined)
        throw new Error('No-workspace strategy cannot have source or hooks');
    } else text(b.source, 'source');
    if (b.diaryId !== undefined) text(b.diaryId, 'diaryId');
    if (b.default !== undefined && typeof b.default !== 'boolean')
      throw new Error('default must be a boolean');
    if (b.default) {
      const key = JSON.stringify([apiUrl, b.teamId, b.projectId]);
      if (defaults.has(key))
        throw new Error('Multiple default bindings for the same project');
      defaults.add(key);
    }
    if (b.hooks !== undefined) {
      const hooks = object(b.hooks, 'hooks');
      fields(hooks, ['afterCreate', 'beforeRun'], 'hooks');
      for (const hook of Object.values(hooks)) {
        const h = object(hook, 'hook');
        fields(h, ['command', 'args', 'timeoutMs'], 'hook');
        text(h.command, 'hook command');
        if (
          !Array.isArray(h.args) ||
          !h.args.every((arg) => typeof arg === 'string' && !arg.includes('\0'))
        )
          throw new Error('hook args must be strings');
        if (
          !Number.isSafeInteger(h.timeoutMs) ||
          (h.timeoutMs as number) < 1 ||
          (h.timeoutMs as number) > 600_000
        )
          throw new Error('hook timeoutMs must be between 1 and 600000');
      }
    }
  }
}

export async function readProjectConfig(
  path = getProjectConfigPath(),
): Promise<ProjectConfig> {
  let data: string;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1_048_576)
      throw new Error('Project config must be a regular file of at most 1 MiB');
    data = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { version: 1, bindings: [] };
    throw error;
  }
  const value: unknown = JSON.parse(data);
  validateProjectConfig(value);
  return value;
}

/** Read-modify-write under the same canonical writer-lock convention as Go. */
export async function updateProjectConfig(
  path: string,
  mutate: (config: ProjectConfig) => void | Promise<void>,
): Promise<void> {
  await withConfigLock(path, async () => {
    const config = await readProjectConfig(path);
    await mutate(config);
    validateProjectConfig(config);
    const data = `${JSON.stringify(config, null, 2)}\n`;
    if (Buffer.byteLength(data) > 1_048_576)
      throw new Error('Project config exceeds 1 MiB');
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, data, { mode: 0o600, flag: 'wx' });
      await rename(temp, path);
    } finally {
      await unlink(temp).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  });
}

async function directory(path: string): Promise<string> {
  const canonical = await realpath(path);
  if (!(await stat(canonical)).isDirectory())
    throw new Error(`Workspace source is not a directory: ${path}`);
  return canonical;
}
function ancestor(parent: string, child: string): boolean {
  const suffix = relative(parent, child);
  return (
    suffix === '' ||
    (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`))
  );
}

/** Non-secret selection only: no remote checks, hooks, materialization or credential lookup. */
export async function resolveProjectBinding(
  config: ProjectConfig,
  options: ProjectSelectionOptions,
): Promise<ProjectBinding | null> {
  validateProjectConfig(config);
  const base = dirname(resolve(options.configPath ?? getProjectConfigPath()));
  const matches = (b: ProjectBinding) =>
    (!options.apiUrl || endpoint(b.apiUrl) === endpoint(options.apiUrl)) &&
    (!options.teamId || b.teamId === options.teamId) &&
    (!options.projectId || b.projectId === options.projectId);
  let candidates = config.bindings.filter(matches);
  if (options.binding) {
    candidates = candidates.filter((b) => b.name === options.binding);
    if (!candidates.length)
      throw new Error(
        `Binding ${options.binding} does not match the requested project, team or endpoint`,
      );
  } else if (options.native) {
    const cwd = await directory(options.cwd);
    const ancestors: { binding: ProjectBinding; path: string }[] = [];
    for (const b of candidates) {
      if (!b.source) continue;
      let path: string;
      try {
        path = await directory(resolve(base, b.source));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      if (ancestor(path, cwd)) ancestors.push({ binding: b, path });
    }
    const depth = Math.max(-1, ...ancestors.map((item) => item.path.length));
    candidates = ancestors
      .filter((item) => item.path.length === depth)
      .map((item) => item.binding);
  } else if (candidates.length > 1) {
    const projects = new Set(
      candidates.map((b) =>
        JSON.stringify([endpoint(b.apiUrl), b.teamId, b.projectId]),
      ),
    );
    const defaults =
      projects.size === 1 ? candidates.filter((b) => b.default) : [];
    if (defaults.length === 1) candidates = defaults;
  }
  if (!candidates.length) {
    if (options.projectId)
      throw new Error(
        'No matching project binding; register a local folder or select a binding',
      );
    return null;
  }
  if (candidates.length !== 1)
    throw new Error(
      `Ambiguous project binding: ${candidates.map((b) => b.name).join(', ')}; select a binding explicitly`,
    );
  const result = structuredClone(candidates[0]);
  const overrides = options.overrides ?? {};
  Object.assign(result, overrides);
  if (result.strategy === 'none') {
    if (overrides.source !== undefined)
      throw new Error('No-workspace override cannot specify a source');
    delete result.source;
    delete result.hooks;
  }
  validateProjectConfig({ version: 1, bindings: [result] });
  if (result.source)
    result.source = await directory(
      resolve(
        overrides.source !== undefined ? options.cwd : base,
        result.source,
      ),
    );
  result.apiUrl = endpoint(result.apiUrl);
  return result;
}
