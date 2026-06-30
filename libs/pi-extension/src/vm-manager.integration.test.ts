import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ensureSnapshot } from './snapshot.js';
import { resumeVm } from './vm-manager.js';

const describeVm =
  process.env.MOLTNET_PI_VM_INTEGRATION === '1' ? describe : describe.skip;

async function execGuest(
  vm: Awaited<ReturnType<typeof resumeVm>>['vm'],
  command: string,
): Promise<string> {
  const proc = vm.exec(['/bin/sh', '-lc', command], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let output = '';
  if ('output' in proc && typeof proc.output === 'function') {
    for await (const chunk of proc.output()) {
      output +=
        typeof chunk.data === 'string'
          ? chunk.data
          : Buffer.from(chunk.data).toString('utf8');
    }
  }
  const result = await proc;
  if ('stdout' in result) output += String(result.stdout ?? '');
  if ('stderr' in result) output += String(result.stderr ?? '');
  if (result.exitCode !== 0) {
    throw new Error(
      `guest command failed (${result.exitCode}):\n${command}\n${output}`,
    );
  }
  return output;
}

describeVm('resumeVm real Gondolin VM integration', () => {
  it('uses native tmpfs for configured package-manager stores and node_modules shadows', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-integration-'));
    const workspace = path.join(root, 'workspace');
    const agentDir = path.join(root, '.moltnet', 'legreffier');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      path.join(agentDir, 'moltnet.json'),
      JSON.stringify({
        endpoints: { api: 'https://api.themolt.net' },
      }),
      'utf8',
    );
    writeFileSync(path.join(agentDir, 'env'), '', 'utf8');

    const sandboxConfig = {
      env: {
        NPM_CONFIG_STORE_DIR: '/opt/pnpm-store',
      },
      snapshot: {
        overlaySize: '3G',
      },
    };

    const checkpointPath = await ensureSnapshot({
      config: sandboxConfig.snapshot,
    });
    const managed = await resumeVm({
      checkpointPath,
      agentName: 'legreffier',
      agentRootDir: root,
      mountPath: workspace,
      sandboxConfig,
    });

    try {
      const output = await execGuest(
        managed.vm,
        `
set -eu
cd "$MOLTNET_GUEST_WORKSPACE"
mkdir -p .worktrees/testing
mkdir .worktrees/testing/node_modules
mkdir .worktrees/testing/node_modules/probe
echo ok > .worktrees/testing/node_modules/probe/file.txt
awk '$2 == "/opt/pnpm-store" { print $3 }' /proc/mounts
test -f .worktrees/testing/node_modules/probe/file.txt
`,
      );

      expect(output.trim()).toBe('tmpfs');
      expect(
        existsSync(path.join(workspace, '.worktrees/testing/node_modules')),
      ).toBe(false);
    } finally {
      await managed.vm.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
