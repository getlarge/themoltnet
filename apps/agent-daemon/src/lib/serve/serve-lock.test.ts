import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { acquireServeLock, withServeLock } from './serve-lock.js';

const roots: string[] = [];
const children: ChildProcess[] = [];

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'serve-lock-'));
  roots.push(root);
  return root;
}

async function lockInChild(root: string): Promise<ChildProcess> {
  const fixture = join(
    import.meta.dirname,
    '../../../test-fixtures/serve-lock-child.ts',
  );
  const child = spawn(process.execPath, ['--import', 'tsx', fixture, root], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  await new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(
      () => reject(new Error('child lock fixture did not become ready')),
      5_000,
    );
    child.once('error', reject);
    child.once('exit', (code) =>
      reject(new Error(`child lock fixture exited early with ${code}`)),
    );
    child.stdout?.once('data', (chunk: Buffer) => {
      if (!chunk.toString('utf8').includes('locked')) return;
      clearTimeout(timer);
      resolvePromise();
    });
  });
  return child;
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolvePromise) => {
    child.once('exit', () => resolvePromise());
  });
}

afterEach(async () => {
  for (const child of children.splice(0)) await stopChild(child);
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('serve singleton lock', () => {
  it('excludes another process on the same root without retrying', async () => {
    const root = freshRoot();
    await lockInChild(root);

    await expect(acquireServeLock(root)).rejects.toMatchObject({
      code: 'held',
    });
  });

  it('allows independent roots and releases after signal shutdown', async () => {
    const firstRoot = freshRoot();
    const secondRoot = freshRoot();
    const child = await lockInChild(firstRoot);

    const second = await acquireServeLock(secondRoot);
    await second.release();
    await stopChild(child);

    const reacquired = await acquireServeLock(firstRoot);
    await reacquired.release();
  });

  it('recovers a stale lock', async () => {
    const root = freshRoot();
    const lockPath = join(root, 'serve.lock');
    mkdirSync(lockPath);
    const old = new Date(Date.now() - 10_000);
    utimesSync(lockPath, old, old);

    const held = await acquireServeLock(root, {
      staleMs: 2_000,
      updateMs: 1_000,
    });

    await held.release();
  });

  it('releases after normal shutdown and startup failure', async () => {
    const normalRoot = freshRoot();
    await expect(
      withServeLock(normalRoot, () => Promise.resolve('stopped')),
    ).resolves.toBe('stopped');
    await (await acquireServeLock(normalRoot)).release();

    const failedRoot = freshRoot();
    await expect(
      withServeLock(failedRoot, () =>
        Promise.reject(new Error('listen failed')),
      ),
    ).rejects.toThrow('listen failed');
    await (await acquireServeLock(failedRoot)).release();
  });

  it('reports compromise once and permits a new owner', async () => {
    const root = freshRoot();
    let calls = 0;
    let resolveCompromise!: (error: Error) => void;
    const compromised = new Promise<Error>((resolvePromise) => {
      resolveCompromise = resolvePromise;
    });
    await acquireServeLock(root, {
      staleMs: 2_000,
      updateMs: 1_000,
      onCompromised: (error) => {
        calls += 1;
        resolveCompromise(error);
      },
    });

    rmSync(join(root, 'serve.lock'), { recursive: true, force: true });
    const error = await compromised;
    expect(error).toMatchObject({ code: 'compromised' });
    expect(calls).toBe(1);

    const recovered = await acquireServeLock(root);
    await recovered.release();
  });
});
