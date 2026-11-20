import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, it } from 'vitest';

import { ensureCachedSnapshot } from '../src/snapshot-cache.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
const worker = fileURLToPath(
  new URL('./fixtures/snapshot-cache-worker.ts', import.meta.url),
);
const loader = createRequire(import.meta.url).resolve('tsx');
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'snapshot-lock-'));
  dirs.push(dir);
  return {
    dir,
    path: join(dir, 'snapshot.qcow2'),
    marker: join(dir, 'builds'),
  };
}
function launch(path: string, marker: string, pause = 300) {
  const child = spawn(
    process.execPath,
    ['--import', loader, worker, path, marker, String(pause)],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = once(child, 'exit').then(([code]) => {
    expect(code, stderr).toBe(0);
  });
  return { child, exited };
}
it('serializes independent processes and never exposes a partially written checkpoint', async () => {
  const { path, marker } = fixture();
  const a = launch(path, marker);
  await once(a.child, 'message');
  expect(existsSync(path)).toBe(false);
  const b = launch(path, marker);
  await Promise.all([a.exited, b.exited]);
  expect(readFileSync(path, 'utf8')).toBe('complete');
  expect(readFileSync(marker, 'utf8').trim().split('\n')).toHaveLength(1);
  expect(existsSync(path + '.lock')).toBe(false);
});
it('recovers a dead builder without reusing its partial checkpoint', async () => {
  const { dir, path, marker } = fixture();
  const a = launch(path, marker, 60_000);
  // This worker is deliberately killed; its exit is asserted separately.
  void a.exited.catch(() => {});
  await once(a.child, 'message');
  const exited = once(a.child, 'exit');
  a.child.kill('SIGKILL');
  await exited;
  expect(existsSync(path)).toBe(false);
  const old = new Date(Date.now() - 120_000);
  utimesSync(path + '.lock', old, old);
  const b = launch(path, marker);
  await b.exited;
  expect(readFileSync(path, 'utf8')).toBe('complete');
  expect(readFileSync(marker, 'utf8').trim().split('\n')).toHaveLength(2);
  expect(
    readdirSync(dir).filter((name) => name.includes('.building-')),
  ).toHaveLength(0);
});
it('does not publish failed builds and allows the next build to succeed', async () => {
  const { path } = fixture();
  await expect(
    ensureCachedSnapshot(path, () => Promise.reject(new Error('build failed'))),
  ).rejects.toThrow('build failed');
  expect(existsSync(path)).toBe(false);
  await ensureCachedSnapshot(path, (pending) => {
    return Promise.resolve(writeFileSync(pending, 'complete'));
  });
  expect(readFileSync(path, 'utf8')).toBe('complete');
});
