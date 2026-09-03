import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  loadDaemonRuntimeAdapter,
  resolveRuntimeModuleUrl,
} from '../../runtime-loader.js';
import { assertStoreName, ServeStoreError } from './store.js';

export interface RuntimeRegistration {
  kind: string;
  moduleUrl: string;
  entryHash: string;
  lockfilePath?: string;
  lockfileHash?: string;
  registeredAt: string;
}

const LOCKFILE_NAMES = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
];

/** Local, operator-owned allowlist for executable daemon runtime modules. */
export class RuntimeRegistry {
  constructor(private readonly root: string) {}

  private get path(): string {
    return join(this.root, 'runtime-registry.json');
  }

  list(): RuntimeRegistration[] {
    if (!existsSync(this.path)) return [];
    const value = JSON.parse(readFileSync(this.path, 'utf8')) as unknown;
    if (!Array.isArray(value) || !value.every(isRegistration))
      throw new ServeStoreError(
        'invalid_state',
        'runtime registry contains an invalid registration',
      );
    return value;
  }

  async register(
    kind: string,
    specifier: string,
    cwd = process.cwd(),
  ): Promise<RuntimeRegistration> {
    kind = assertStoreName('runtime kind', kind);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const moduleUrl = resolveRuntimeModuleUrl(specifier, cwd);
    const adapter = await loadDaemonRuntimeAdapter(specifier, { cwd });
    if (adapter.runtimeKind !== kind) {
      throw new Error(
        `Runtime module provides "${adapter.runtimeKind}", not registered kind "${kind}".`,
      );
    }
    if (!moduleUrl.startsWith('file:'))
      throw new Error('Runtime registration must resolve to a local file URL.');
    const entryHash = hashFile(new URL(moduleUrl));
    const lockfilePath = isPackageSpecifier(specifier)
      ? findLockfile(cwd)
      : undefined;
    if (isPackageSpecifier(specifier) && !lockfilePath) {
      throw new Error(
        'Package runtime registration requires a pnpm, npm, Yarn, or Bun lockfile in the current project or a parent directory.',
      );
    }
    const entry: RuntimeRegistration = {
      kind,
      moduleUrl,
      entryHash,
      ...(lockfilePath
        ? { lockfilePath, lockfileHash: hashPath(lockfilePath) }
        : {}),
      registeredAt: new Date().toISOString(),
    };
    const entries = this.list().filter((candidate) => candidate.kind !== kind);
    entries.push(entry);
    writeRegistry(this.path, entries);
    return entry;
  }

  unregister(kind: string): boolean {
    kind = assertStoreName('runtime kind', kind);
    const entries = this.list();
    const next = entries.filter((entry) => entry.kind !== kind);
    if (next.length === entries.length) return false;
    writeRegistry(this.path, next);
    return true;
  }

  resolve(kind: string): RuntimeRegistration | undefined {
    kind = assertStoreName('runtime kind', kind);
    const entry = this.list().find((candidate) => candidate.kind === kind);
    if (!entry) return undefined;
    if (hashFile(new URL(entry.moduleUrl)) !== entry.entryHash) {
      throw new Error(
        `Registered runtime "${kind}" has changed; re-register it before starting a run.`,
      );
    }
    if (
      entry.lockfilePath &&
      (!existsSync(entry.lockfilePath) ||
        hashPath(entry.lockfilePath) !== entry.lockfileHash)
    ) {
      throw new Error(
        `Registered runtime "${kind}" lockfile has changed; re-register it before starting a run.`,
      );
    }
    return entry;
  }
}

function hashFile(url: URL): string {
  return createHash('sha256').update(readFileSync(url)).digest('hex');
}

function hashPath(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function isPackageSpecifier(specifier: string): boolean {
  return (
    !specifier.startsWith('file:') &&
    !specifier.startsWith('.') &&
    !specifier.startsWith('/')
  );
}

function findLockfile(cwd: string): string | undefined {
  let current = resolve(cwd);
  for (;;) {
    for (const name of LOCKFILE_NAMES) {
      const candidate = join(current, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function isRegistration(value: unknown): value is RuntimeRegistration {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<RuntimeRegistration>;
  return (
    typeof entry.kind === 'string' &&
    typeof entry.moduleUrl === 'string' &&
    entry.moduleUrl.startsWith('file:') &&
    typeof entry.entryHash === 'string' &&
    typeof entry.registeredAt === 'string' &&
    (entry.lockfilePath === undefined ||
      typeof entry.lockfilePath === 'string') &&
    (entry.lockfileHash === undefined ||
      typeof entry.lockfileHash === 'string') &&
    (entry.lockfilePath === undefined) === (entry.lockfileHash === undefined)
  );
}

function writeRegistry(path: string, entries: RuntimeRegistration[]): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}
