import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export interface DaemonStateDirs {
  rootDir: string;
  mountPath?: string;
  piSessionsDir: string;
}

export function ensureDaemonStateDirs(mountPath: string): DaemonStateDirs {
  const rootDir = canonicalStatePath(join(mountPath, '.moltnet', 'd'));
  const piSessionsDir = join(rootDir, 'pi-sessions');
  mkdirSync(rootDir, { recursive: true, mode: 0o700 });
  mkdirSync(piSessionsDir, { recursive: true, mode: 0o700 });
  return {
    rootDir: realpathSync(rootDir),
    piSessionsDir: realpathSync(piSessionsDir),
  };
}

// Resolve existing aliases before creating any new descendants. This keeps the
// same explicit state location stable when callers use symlinked parent paths.
function canonicalStatePath(path: string): string {
  let parent = resolve(path);
  const missing: string[] = [];
  while (!existsSync(parent)) {
    missing.unshift(basename(parent));
    const next = dirname(parent);
    if (next === parent)
      throw new Error(`Cannot resolve daemon state root ${path}`);
    parent = next;
  }
  return join(realpathSync(parent), ...missing);
}
