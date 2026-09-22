import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { acquireAgentServerLock, withAgentServerLock } from './lock.js';

const roots: string[] = [];
const children: ChildProcess[] = [];

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'lock-'));
  roots.push(root);
  return root;
}

async function lockInChild(root: string): Promise<ChildProcess> {
  const fixture = join(
    import.meta.dirname,
    '../../../test-fixtures/agent-server-lock-child.ts',
  );
  const child = spawn(process.execPath, ['--import', 'tsx', fixture, root], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  children.push(child);
  await new Promise<void>((resolvePromise, reject) => {
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-8192);
    });
    const finish = (error?: Error) => {
      clearTimeout(timer);
      child.off('error', onError);
      child.off('exit', onExit);
      child.off('message', onMessage);
      if (error) reject(error);
      else resolvePromise();
    };
    const onError = (error: Error) => finish(error);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
      finish(
        new Error(`child lock fixture exited: ${code ?? signal}; ${stderr}`),
      );
    const onMessage = (message: unknown) => {
      if (message === 'locked') finish();
    };
    const timer = setTimeout(
      () =>
        finish(new Error(`child lock fixture did not become ready; ${stderr}`)),
      15_000,
    );
    child.once('error', onError);
    child.once('exit', onExit);
    child.on('message', onMessage);
  });
  return child;
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolvePromise) => {
    child.once('exit', () => resolvePromise());
    child.kill('SIGTERM');
  });
}

afterEach(async () => {
  for (const child of children.splice(0)) await stopChild(child);
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('agent server singleton lock', () => {
  it('excludes another process on the same root without retrying', async () => {
    const root = freshRoot();
    await lockInChild(root);

    await expect(acquireAgentServerLock(root)).rejects.toMatchObject({
      code: 'held',
    });
  }, 20_000);

  it('excludes a daemon holding the connection-state lock during an upgrade', async () => {
    const store = freshRoot();
    const state = join(store, 'environments', 'fixture');
    mkdirSync(state, { recursive: true });
    const previous = await acquireAgentServerLock(state);
    try {
      await expect(
        withAgentServerLock(store, async () => 'started', { stateRoot: state }),
      ).rejects.toMatchObject({ code: 'held' });
    } finally {
      await previous.release();
    }
    await expect(
      withAgentServerLock(store, async () => 'started', { stateRoot: state }),
    ).resolves.toBe('started');
  });

  it('allows independent roots and releases after signal shutdown', async () => {
    const firstRoot = freshRoot();
    const secondRoot = freshRoot();
    const child = await lockInChild(firstRoot);

    const second = await acquireAgentServerLock(secondRoot);
    await second.release();
    await stopChild(child);

    const reacquired = await acquireAgentServerLock(firstRoot);
    await reacquired.release();
  }, 20_000);

  it('recovers a stale lock', async () => {
    const root = freshRoot();
    const lockPath = join(root, 'agent-server.lock');
    mkdirSync(lockPath);
    const old = new Date(Date.now() - 10_000);
    utimesSync(lockPath, old, old);

    const held = await acquireAgentServerLock(root, {
      staleMs: 2_000,
      updateMs: 1_000,
    });

    await held.release();
  });

  it('releases after normal shutdown and startup failure', async () => {
    const normalRoot = freshRoot();
    await expect(
      withAgentServerLock(normalRoot, () => Promise.resolve('stopped')),
    ).resolves.toBe('stopped');
    await (await acquireAgentServerLock(normalRoot)).release();

    const failedRoot = freshRoot();
    await expect(
      withAgentServerLock(failedRoot, () =>
        Promise.reject(new Error('listen failed')),
      ),
    ).rejects.toThrow('listen failed');
    await (await acquireAgentServerLock(failedRoot)).release();
  });

  it('reports compromise once and permits a new owner', async () => {
    const root = freshRoot();
    let calls = 0;
    let resolveCompromise!: (error: Error) => void;
    const compromised = new Promise<Error>((resolvePromise) => {
      resolveCompromise = resolvePromise;
    });
    await acquireAgentServerLock(root, {
      staleMs: 2_000,
      updateMs: 1_000,
      onCompromised: (error) => {
        calls += 1;
        resolveCompromise(error);
      },
    });

    rmSync(join(root, 'agent-server.lock'), { recursive: true, force: true });
    const error = await compromised;
    expect(error).toMatchObject({ code: 'compromised' });
    expect(calls).toBe(1);

    const recovered = await acquireAgentServerLock(root);
    await recovered.release();
  });
});
