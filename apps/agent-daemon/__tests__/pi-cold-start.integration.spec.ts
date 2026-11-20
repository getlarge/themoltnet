import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const describeVm =
  process.env.MOLTNET_PI_VM_INTEGRATION === '1' ? describe : describe.skip;
describeVm('parallel real Pi worker cold start', () => {
  it('prepares four independent generation workers against one empty snapshot cache', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-cold-cache-'));
    const loader = createRequire(import.meta.url).resolve('tsx');
    const entry = fileURLToPath(
      new URL('./fixtures/pi-cold-worker.ts', import.meta.url),
    );
    const workers = Array.from({ length: 4 }, () => {
      const child = spawn(process.execPath, ['--import', loader, entry], {
        env: { ...process.env, MOLTNET_GONDOLIN_CACHE_DIR: dir },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      return {
        child,
        done: once(child, 'exit').then(([code]) => {
          expect(code, stderr).toBe(0);
          return JSON.parse(stdout.trim()) as {
            pid: number;
            manifest: unknown;
          };
        }),
      };
    });
    try {
      const results = await Promise.all(workers.map((worker) => worker.done));
      expect(new Set(results.map((result) => result.pid)).size).toBe(4);
      expect(results.every((result) => result.manifest)).toBe(true);
      const snapshots = readdirSync(dir)
        .filter((name) => name.startsWith('v2-'))
        .map((name) => join(dir, name, 'snapshot.qcow2'))
        .filter(existsSync);
      expect(snapshots).toHaveLength(1);
      expect(statSync(snapshots[0]).size).toBeGreaterThan(0);
    } finally {
      for (const { child } of workers)
        if (child.exitCode === null) child.kill('SIGTERM');
      rmSync(dir, { recursive: true, force: true });
    }
  }, 600_000);
});
