import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(packageRoot, '../..');
const actionPath = resolve(packageRoot, 'action.yml');
const daemonSourcePath = resolve(
  workspaceRoot,
  'apps/agent-daemon/src/main.ts',
);

describe('workspace daemon action contract', () => {
  it('uses a TypeScript-aware source entrypoint in workspace mode', () => {
    const action = readFileSync(actionPath, 'utf8');

    expect(action).toContain('node --import tsx');
    expect(action).toContain(
      '"$GITHUB_WORKSPACE/apps/agent-daemon/src/main.ts"',
    );
    expect(action).not.toContain(
      'node "$GITHUB_WORKSPACE/apps/agent-daemon/dist/main.js"',
    );
  });

  it('boots the workspace daemon entrypoint with plain Node and tsx', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', daemonSourcePath, 'drain', '--help'],
      {
        cwd: workspaceRoot,
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'agent-daemon drain — poll until the queue is empty, then exit.',
    );
  });
});
