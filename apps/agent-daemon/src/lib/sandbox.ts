import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SandboxConfig } from '@themoltnet/pi-extension';

/**
 * Read sandbox.json from the daemon's working directory.
 *
 * The file declares the Gondolin snapshot id and egress allowlist used
 * for every task this daemon runs. It must be present at startup; we
 * fail fast rather than letting the executor blow up mid-task.
 */
export function loadSandboxConfig(cwd: string): SandboxConfig {
  const path = join(cwd, 'sandbox.json');
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SandboxConfig;
  } catch (err) {
    const isEnoent =
      err instanceof Error && 'code' in err && err.code === 'ENOENT';
    throw new Error(
      isEnoent
        ? `sandbox.json not found at ${path}. Run the daemon from the worktree root.`
        : `Failed to read sandbox.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
