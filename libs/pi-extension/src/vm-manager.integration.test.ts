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
  it('allows configured runtime hosts and blocks unlisted hosts', async () => {
    // Arrange
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-egress-'));
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

    const checkpointPath = await ensureSnapshot();
    const managed = await resumeVm({
      checkpointPath,
      agentName: 'legreffier',
      agentRootDir: root,
      mountPath: workspace,
      sandboxConfig: {
        network: { allowedHosts: ['example.com'] },
      },
    });

    try {
      // Act
      const output = await execGuest(
        managed.vm,
        `
set -eu
curl -fsS --max-time 20 https://example.com >/dev/null
if curl -fsS --max-time 10 https://example.org >/dev/null 2>&1; then
  echo unlisted-host-reachable
  exit 1
fi
echo policy-enforced
`,
      );

      // Assert
      expect(output).toContain('policy-enforced');
    } finally {
      await managed.vm.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it('keeps stores reusable and future worktree node_modules executable', async () => {
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
        setupCommands: [
          'mkdir -p /opt/pnpm-store && chown 501:501 /opt/pnpm-store && chmod 0755 /opt/pnpm-store',
        ],
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
test -f .worktrees/testing/node_modules/probe/file.txt
mkdir .worktrees/testing/node_modules/.bin
cat > .worktrees/testing/node_modules/.bin/probe <<'SH'
#!/bin/sh
echo probe-ok
SH
test "$(.worktrees/testing/node_modules/.bin/probe)" = probe-ok
su agent -c 'touch /opt/pnpm-store/agent-write'
python3 - <<'PY'
import json
import os
import shutil
import statistics
import time

workspace = os.environ["MOLTNET_GUEST_WORKSPACE"]
store = os.environ["NPM_CONFIG_STORE_DIR"]
workspace_dir = os.path.join(workspace, ".worktrees/testing/.bench-workspace")
store_dir = os.path.join(store, "bench")

def mount_type(mount_path):
    with open("/proc/mounts", "r", encoding="utf8") as f:
        for line in f:
            parts = line.split()
            if len(parts) >= 3 and parts[1] == mount_path:
                return parts[2]
    return None

def bench(directory):
    shutil.rmtree(directory, ignore_errors=True)
    os.makedirs(directory, exist_ok=True)
    start = time.perf_counter()
    for i in range(500):
        with open(os.path.join(directory, f"file-{i}.txt"), "w", encoding="utf8") as f:
            f.write("x\\n")
    return int((time.perf_counter() - start) * 1000)

def median_bench(directory):
    return statistics.median(bench(directory) for _ in range(3))

print(json.dumps({
    "storeMountType": mount_type(store),
    "workspaceMs": median_bench(workspace_dir),
    "storeMs": median_bench(store_dir),
}, sort_keys=True))
PY
`,
      );

      const benchmark = JSON.parse(output.trim()) as {
        storeMountType: string | null;
        storeMs: number;
        workspaceMs: number;
      };
      expect(benchmark.storeMountType).not.toBe('tmpfs');
      console.info(`guest-local store benchmark: ${JSON.stringify(benchmark)}`);
      expect(
        existsSync(path.join(workspace, '.worktrees/testing/node_modules')),
      ).toBe(false);
    } finally {
      await managed.vm.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
