import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import type { SandboxConfig } from '@themoltnet/pi-extension';

export interface ResolvedSandbox {
  config: SandboxConfig;
  /** Directory containing sandbox.json — used as the VM mountPath. */
  rootDir: string;
  /** Absolute path to the resolved sandbox.json file. */
  path: string;
}

// Search up from `startDir` for a sandbox.json. Stops at the filesystem
// root if not found. The directory containing the file becomes both the
// config source AND the VM mount path, so the daemon can be invoked from
// any subdirectory of the repo without mismatching the two.
export function resolveSandbox(
  startDir: string,
  explicitPath?: string,
): ResolvedSandbox {
  const path = explicitPath
    ? isAbsolute(explicitPath)
      ? explicitPath
      : resolve(startDir, explicitPath)
    : findUp(startDir, 'sandbox.json');

  if (!path) {
    throw new Error(
      `sandbox.json not found in ${startDir} or any parent directory. ` +
        `Pass --sandbox <path> or run the daemon from a directory with sandbox.json at or above it.`,
    );
  }

  let config: SandboxConfig;
  try {
    config = JSON.parse(readFileSync(path, 'utf8')) as SandboxConfig;
  } catch (err) {
    const isEnoent =
      err instanceof Error && 'code' in err && err.code === 'ENOENT';
    throw new Error(
      isEnoent
        ? `sandbox.json not found at ${path}.`
        : `Failed to read sandbox.json at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { config, rootDir: dirname(path), path };
}

function findUp(startDir: string, filename: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    const candidate = resolve(dir, filename);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
