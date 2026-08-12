import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(packageRoot, '../..');
const actionPath = resolve(packageRoot, 'action.yml');
const multiLensWorkflowPath = resolve(
  workspaceRoot,
  '.github/workflows/multi-lens-review.yml',
);
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

  it('keeps agent-key execution configless and requires only its signing seed', () => {
    const action = readFileSync(actionPath, 'utf8');
    const agentKeyBranch = action.slice(
      action.indexOf('if [ -n "${MOLTNET_AGENT_KEY:-}" ]; then'),
      action.indexOf('if [ -n "${MOLTNET_GITHUB_APP_PRIVATE_KEY:-}" ]; then'),
    );

    expect(agentKeyBranch).toContain(
      'MOLTNET_PRIVATE_KEY is required with MOLTNET_AGENT_KEY',
    );
    expect(agentKeyBranch).toContain(
      'Using configless MoltNet agent-key authentication',
    );
    expect(agentKeyBranch).toContain('exit 0');
    expect(agentKeyBranch).not.toContain('config init-from-env');
    expect(agentKeyBranch).not.toContain('MOLTNET_CLIENT_SECRET');
    expect(agentKeyBranch).not.toContain('MOLTNET_PUBLIC_KEY');
  });

  it('retains config materialization for OAuth execution', () => {
    const action = readFileSync(actionPath, 'utf8');

    expect(action).toContain('OAuth mode reconstructs the agent');
    expect(action).toContain('npx -y @themoltnet/cli config init-from-env');
  });

  it('keeps multi-lens workers on the minimal configless secret set', () => {
    const workflow = readFileSync(multiLensWorkflowPath, 'utf8');

    expect(workflow).toContain(
      'MOLTNET_AGENT_KEY: ${{ secrets.MOLTNET_AGENT_KEY }}',
    );
    expect(workflow).toContain(
      'MOLTNET_PRIVATE_KEY: ${{ secrets.MOLTNET_PRIVATE_KEY }}',
    );
    expect(workflow).not.toContain('secrets.MOLTNET_IDENTITY_ID');
    expect(workflow).not.toContain('secrets.MOLTNET_CLIENT_ID');
    expect(workflow).not.toContain('secrets.MOLTNET_CLIENT_SECRET');
    expect(workflow).not.toContain('secrets.MOLTNET_PUBLIC_KEY');
    expect(workflow).not.toContain('secrets.MOLTNET_FINGERPRINT');
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
  }, 30_000);
});
