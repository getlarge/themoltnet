import { constants } from 'node:fs';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { getConfigDir } from './config.js';
import { withConfigLock } from './config-lock.js';
import { assertProjectConfigOwner } from './project-config-owner.js';
import type { StoreRootOptions } from './store-root.js';
import { writeFileAtomic } from './write-file-atomic.js';

export class ProjectConfigError extends Error {
  constructor(
    readonly kind: 'validation' | 'version' | 'selection' | 'io',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
function contextualError(
  error: unknown,
  kind: ProjectConfigError['kind'],
  context = '',
): ProjectConfigError {
  return new ProjectConfigError(
    error instanceof ProjectConfigError ? error.kind : kind,
    `${context}${error instanceof Error ? error.message : String(error)}`,
    { cause: error },
  );
}

const MAX_CONFIG_BYTES = 1_048_576;
const MAX_HOOK_TIMEOUT_MS = 600_000;

export const WORKSPACE_STRATEGIES = [
  'none',
  'existing',
  'git-worktree',
  'isolated-directory',
] as const;
export type WorkspaceStrategy = (typeof WORKSPACE_STRATEGIES)[number];
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

/** The one place that names the file; a supervisor passes the store it hands its workers. */
export function getProjectConfigPath(options?: StoreRootOptions): string {
  return join(getConfigDir(options), 'projects.json');
}

function validateUnicode(value: unknown, ancestors = new Set<object>()): void {
  if (
    typeof value === 'string' &&
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      value,
    )
  )
    throw new Error('Strings must contain well-formed Unicode');
  if (value && typeof value === 'object') {
    if (ancestors.has(value))
      throw new Error('Project config must not contain cycles');
    ancestors.add(value);
    for (const [key, child] of Object.entries(value)) {
      validateUnicode(key, ancestors);
      validateUnicode(child, ancestors);
    }
    ancestors.delete(value);
  }
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
function requireNonEmptyString(
  value: unknown,
  label: string,
): asserts value is string {
  if (
    typeof value !== 'string' ||
    !value.replace(/[\s\u0085]/gu, '') ||
    value.includes('\0')
  )
    throw new Error(`${label} must be a non-empty string`);
}
// Deliberately narrower than WHATWG URL parsing; Go implements this same grammar.
export function normalizeProjectEndpoint(value: string): string {
  const fail = () => {
    throw new Error(
      'apiUrl must be a canonical HTTP(S) endpoint; use HTTPS except for loopback',
    );
  };
  const match =
    /^(https?):\/\/(\[[0-9a-f:]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([1-9][0-9]{0,4}))?((?:\/[A-Za-z0-9._~-]+)*\/?)$/.exec(
      value,
    );
  if (!match) return fail();
  const [, scheme, host, port, path] = match;
  if (
    port &&
    (+port > 65535 || (scheme === 'https' ? port === '443' : port === '80'))
  )
    return fail();
  if (host.startsWith('[')) {
    const address = host.slice(1, -1);
    if (
      isIP(address) !== 6 ||
      new URL(`https://${host}`).hostname !== host ||
      /^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(address)
    )
      return fail();
  } else if (/^(?:[0-9]+|0x[0-9a-f]+)$/.test(host.split('.').at(-1) ?? '')) {
    if (isIP(host) !== 4) return fail();
  } else if (
    !host
      .split('.')
      .every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
  )
    return fail();
  if (path.split('/').some((segment) => segment === '.' || segment === '..'))
    return fail();
  if (
    scheme === 'http' &&
    host !== 'localhost' &&
    host !== '[::1]' &&
    !(isIP(host) === 4 && host.startsWith('127.'))
  )
    return fail();
  return value.replace(/\/$/, '');
}

export function validateProjectConfig(
  value: unknown,
): asserts value is ProjectConfig {
  try {
    validateProjectConfigValue(value);
  } catch (error) {
    throw contextualError(error, 'validation');
  }
}

/** Strict versioned local contract. This validates data, never resolves credentials. */
function validateProjectConfigValue(
  value: unknown,
): asserts value is ProjectConfig {
  validateUnicode(value);
  const config = object(value, 'Project config');
  if (config.version !== 1)
    throw new ProjectConfigError(
      'version',
      typeof config.version === 'number' && config.version > 1
        ? 'Newer project config version; upgrade moltnet and the daemon/SDK'
        : 'Invalid project config version; expected 1',
    );
  fields(config, ['version', 'bindings'], 'config');
  if (!Array.isArray(config.bindings))
    throw new Error('bindings must be an array');
  const names = new Set<string>();
  const defaults = new Set<string>();
  for (const [index, item] of (config.bindings as unknown[]).entries()) {
    try {
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
        requireNonEmptyString(b[key], key);
      const name = b.name as string;
      if (names.has(name)) throw new Error(`Duplicate binding name: ${name}`);
      names.add(name);
      const apiUrl = normalizeProjectEndpoint(b.apiUrl as string);
      if (!WORKSPACE_STRATEGIES.includes(b.strategy as WorkspaceStrategy))
        throw new Error('An explicit workspace strategy is required');
      if (b.strategy === 'none') {
        if (b.source !== undefined || b.hooks !== undefined)
          throw new Error('No-workspace strategy cannot have source or hooks');
      } else requireNonEmptyString(b.source, 'source');
      if (b.diaryId !== undefined) requireNonEmptyString(b.diaryId, 'diaryId');
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
          requireNonEmptyString(h.command, 'hook command');
          if (
            !isAbsolute(h.command) &&
            (/[\\/]/.test(h.command) || h.command === '.' || h.command === '..')
          )
            throw new Error(
              'hook command must be an absolute path or a bare PATH name',
            );
          if (
            !Array.isArray(h.args) ||
            !h.args.every(
              (arg) => typeof arg === 'string' && !arg.includes('\0'),
            )
          )
            throw new Error('hook args must be strings');
          if (
            !Number.isSafeInteger(h.timeoutMs) ||
            (h.timeoutMs as number) < 1 ||
            (h.timeoutMs as number) > MAX_HOOK_TIMEOUT_MS
          )
            throw new Error('hook timeoutMs must be between 1 and 600000');
        }
      }
    } catch (error) {
      const name =
        item &&
        typeof item === 'object' &&
        'name' in item &&
        typeof item.name === 'string'
          ? ` (${item.name})`
          : '';
      throw contextualError(error, 'validation', `bindings[${index}]${name}: `);
    }
  }
}

export async function readProjectConfig(
  path = getProjectConfigPath(),
): Promise<ProjectConfig> {
  let observed = false;
  try {
    const info = await lstat(path);
    observed = true;
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_CONFIG_BYTES)
      throw new Error('Project config must be a regular file of at most 1 MiB');
    assertProjectConfigOwner(info);
    const handle = await open(
      path,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    try {
      const opened = await handle.stat();
      assertProjectConfigOwner(opened);
      if (
        !opened.isFile() ||
        opened.dev !== info.dev ||
        opened.ino !== info.ino ||
        opened.size > MAX_CONFIG_BYTES
      )
        throw new Error('Project config changed while opening');
      const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
      let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await handle.read(
          buffer,
          size,
          buffer.length - size,
          null,
        );
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > MAX_CONFIG_BYTES)
        throw new Error('Project config exceeds 1 MiB');
      let value: unknown;
      try {
        value = JSON.parse(
          new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
            buffer.subarray(0, size),
          ),
        );
      } catch (error) {
        throw contextualError(error, 'validation');
      }
      validateProjectConfig(value);
      return value;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!observed && (error as NodeJS.ErrnoException).code === 'ENOENT')
      return { version: 1, bindings: [] };
    throw contextualError(error, 'io', `${path}: `);
  }
}

/** Read-modify-write under the same canonical writer-lock convention as Go. */
export async function updateProjectConfig(
  path: string,
  mutate: (config: ProjectConfig) => void | Promise<void>,
): Promise<void> {
  await withConfigLock(path, async () => {
    try {
      assertProjectConfigOwner(await lstat(path), true);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw contextualError(error, 'io', `${path}: `);
    }
    const config = await readProjectConfig(path);
    await mutate(config);
    validateProjectConfig(config);
    for (const binding of config.bindings)
      binding.apiUrl = normalizeProjectEndpoint(binding.apiUrl);
    const data = `${JSON.stringify(config, null, 2)}\n`;
    if (Buffer.byteLength(data) > MAX_CONFIG_BYTES)
      throw new Error('Project config exceeds 1 MiB');
    await writeFileAtomic(path, data);
  });
}

export async function canonicalDirectory(path: string): Promise<string> {
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

async function selectAncestors(
  candidates: ProjectBinding[],
  cwdPath: string,
  base: string,
  canonicalize: typeof canonicalDirectory,
): Promise<ProjectBinding[]> {
  const cwd = await canonicalize(cwdPath);
  const ancestors: { binding: ProjectBinding; path: string }[] = [];
  const resolved = await Promise.all(
    candidates.map(async (binding) => {
      if (!binding.source) return null;
      try {
        const path = await canonicalize(resolve(base, binding.source));
        return ancestor(path, cwd) ? { binding, path } : null;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        throw new Error(
          `Registered source for binding ${binding.name} is unavailable: ${binding.source}`,
          { cause: error },
        );
      }
    }),
  );
  for (const item of resolved) if (item) ancestors.push(item);
  const pathLength = Math.max(-1, ...ancestors.map((item) => item.path.length));
  return ancestors
    .filter((item) => item.path.length === pathLength)
    .map((item) => item.binding);
}

/** Non-secret selection only: no remote checks, hooks, materialization or credential lookup. */
async function resolveProjectBindingValue(
  config: ProjectConfig,
  options: ProjectSelectionOptions,
): Promise<ProjectBinding | null> {
  // Public callers may mutate a previously read config; validate at this boundary.
  validateProjectConfig(config);
  const paths = new Map<string, Promise<string>>();
  const canonicalize = (path: string) => {
    const absolute = resolve(path);
    let result = paths.get(absolute);
    if (!result) {
      result = canonicalDirectory(absolute);
      paths.set(absolute, result);
    }
    return result;
  };
  const base = dirname(resolve(options.configPath ?? getProjectConfigPath()));
  const matches = (b: ProjectBinding) =>
    (!options.apiUrl ||
      normalizeProjectEndpoint(b.apiUrl) ===
        normalizeProjectEndpoint(options.apiUrl)) &&
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
    candidates = await selectAncestors(
      candidates,
      options.cwd,
      base,
      canonicalize,
    );
  } else if (candidates.length > 1) {
    const projects = new Set(
      candidates.map((b) =>
        JSON.stringify([
          normalizeProjectEndpoint(b.apiUrl),
          b.teamId,
          b.projectId,
        ]),
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
  return applyOverrides(candidates[0], options, base, canonicalize);
}

async function applyOverrides(
  binding: ProjectBinding,
  options: ProjectSelectionOptions,
  base: string,
  canonicalize: typeof canonicalDirectory,
): Promise<ProjectBinding> {
  const result = structuredClone(binding);
  const input = object(options.overrides ?? {}, 'overrides');
  const overrides: NonNullable<ProjectSelectionOptions['overrides']> = {};
  for (const key of Reflect.ownKeys(input)) {
    if (
      typeof key !== 'string' ||
      !['source', 'strategy', 'diaryId'].includes(key)
    )
      throw new Error(`Unknown override field: ${String(key)}`);
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (!Object.hasOwn(descriptor, 'value'))
      throw new Error('Overrides must contain only data properties');
    Object.defineProperty(overrides, key, {
      value: descriptor.value,
      enumerable: true,
    });
  }
  for (const key of ['source', 'strategy', 'diaryId'] as const) {
    if (Object.hasOwn(overrides, key) && overrides[key] !== undefined)
      Object.defineProperty(result, key, {
        value: overrides[key],
        writable: true,
        configurable: true,
        enumerable: true,
      });
  }
  if (result.strategy === 'none') {
    if (Object.hasOwn(overrides, 'source') && overrides.source !== undefined)
      throw new Error('No-workspace override cannot specify a source');
    delete result.source;
    delete result.hooks;
  }
  validateProjectConfig({ version: 1, bindings: [result] });
  if (result.source)
    result.source = await canonicalize(
      resolve(
        Object.hasOwn(overrides, 'source') && overrides.source !== undefined
          ? options.cwd
          : base,
        result.source,
      ),
    );
  result.apiUrl = normalizeProjectEndpoint(result.apiUrl);
  return result;
}

export async function resolveProjectBinding(
  config: ProjectConfig,
  options: ProjectSelectionOptions,
): Promise<ProjectBinding | null> {
  try {
    return await resolveProjectBindingValue(config, options);
  } catch (error) {
    throw contextualError(error, 'selection');
  }
}
