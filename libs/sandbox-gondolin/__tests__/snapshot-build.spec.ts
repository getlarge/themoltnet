import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

import { VM } from '@earendil-works/gondolin';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureSnapshot } from '../src/snapshot.js';

const vm = vi.hoisted(() => ({
  exec: vi.fn(),
  checkpoint: vi.fn(),
  close: vi.fn(),
}));

const cacheFs = vi.hoisted(() => ({
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: cacheFs.readdirSync,
  rmSync: vi.fn(),
  statSync: cacheFs.statSync,
}));
vi.mock('@earendil-works/gondolin', () => ({
  createHttpHooks: () => ({ httpHooks: {} }),
  ensureImageSelector: () => ({ assetDir: '/image' }),
  loadGuestAssets: () => ({ rootfsPath: '/image/rootfs.ext4' }),
  VM: { create: vi.fn() },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  cacheFs.readdirSync.mockReturnValue([]);
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(VM.create).mockResolvedValue(vm as unknown as VM);
  vm.exec.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
});
afterEach(() => vi.useRealTimers());

describe('snapshot build bootstrap', () => {
  it('retries package installation before resizing and checkpointing', async () => {
    vm.exec.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'temporary repository failure',
    });
    const progress = vi.fn();

    const build = ensureSnapshot({ onProgress: progress });
    await vi.runAllTimersAsync();
    await build;

    expect(vm.exec.mock.calls.slice(0, 3)).toEqual([
      ['apk add --no-cache e2fsprogs-extra'],
      ['apk add --no-cache e2fsprogs-extra'],
      ['resize2fs /dev/vda'],
    ]);
    expect(progress).toHaveBeenCalledWith(
      expect.stringContaining('temporary repository failure'),
    );
    expect(vm.checkpoint).toHaveBeenCalledOnce();
    expect(vm.close).toHaveBeenCalledOnce();
  });

  it('stops after three failed installs without resizing or checkpointing', async () => {
    vm.exec.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'repository unavailable',
    });

    const failure = expect(ensureSnapshot()).rejects.toThrow(
      'snapshot build "installing rootfs resize tools..." failed (exit 1):\nrepository unavailable',
    );
    await vi.runAllTimersAsync();
    await failure;

    expect(vm.exec).toHaveBeenCalledTimes(3);
    expect(vm.checkpoint).not.toHaveBeenCalled();
    expect(vm.close).toHaveBeenCalledOnce();
  });

  it('fails immediately on resize errors and retains the diagnostic tail', async () => {
    vm.exec
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: 'install progress\n'.repeat(150),
        stderr: `${'progress\n'.repeat(150)}resize2fs: filesystem error`,
      });

    await expect(ensureSnapshot()).rejects.toThrow(
      /snapshot build "resizing rootfs\.\.\." failed.*\n[\s\S]*resize2fs: filesystem error/,
    );

    expect(vm.exec).toHaveBeenCalledTimes(2);
    expect(vm.checkpoint).not.toHaveBeenCalled();
    expect(vm.close).toHaveBeenCalledOnce();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('snapshot build concurrency', () => {
  it('shares a cold build between overlapping callers', async () => {
    const setup = deferred<{ exitCode: number }>();
    vm.exec.mockReturnValueOnce(setup.promise);
    const first = ensureSnapshot();
    await vi.runAllTimersAsync();
    const progress = vi.fn();
    const second = ensureSnapshot({ onProgress: progress });

    expect(VM.create).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledWith(
      expect.stringContaining('waiting for snapshot build:'),
    );
    setup.resolve({ exitCode: 0 });
    const paths = await Promise.all([first, second]);

    expect(paths[0]).toBe(paths[1]);
    expect(vm.checkpoint).toHaveBeenCalledOnce();
    expect(vm.close).toHaveBeenCalledOnce();
  });

  it('waits for checkpoint completion even when its output file exists', async () => {
    const checkpoint = deferred<void>();
    vm.checkpoint.mockImplementationOnce((snapshotPath: string) => {
      vi.mocked(existsSync).mockImplementation((file) => file === snapshotPath);
      return checkpoint.promise;
    });
    const first = ensureSnapshot();
    await vi.runAllTimersAsync();
    expect(vm.checkpoint).toHaveBeenCalledOnce();
    const completed = vi.fn();
    const second = ensureSnapshot().then(completed);
    await vi.runAllTimersAsync();
    expect(completed).not.toHaveBeenCalled();

    checkpoint.resolve();
    const snapshotPath = await first;
    await second;
    expect(completed).toHaveBeenCalledWith(snapshotPath);
    expect(VM.create).toHaveBeenCalledOnce();
  });

  it('removes a failed checkpoint and lets callers retry the build', async () => {
    const checkpoint = deferred<void>();
    vm.checkpoint.mockReturnValueOnce(checkpoint.promise);
    const first = ensureSnapshot();
    const second = ensureSnapshot();
    const failures = Promise.all([
      expect(first).rejects.toThrow('checkpoint failed'),
      expect(second).rejects.toThrow('checkpoint failed'),
    ]);
    await vi.runAllTimersAsync();
    const snapshotPath = vm.checkpoint.mock.calls[0][0];
    checkpoint.reject(new Error('checkpoint failed'));
    await failures;
    expect(rmSync).toHaveBeenCalledWith(snapshotPath, { force: true });

    await expect(ensureSnapshot()).resolves.toBe(snapshotPath);
    expect(VM.create).toHaveBeenCalledTimes(2);
    expect(vm.checkpoint).toHaveBeenCalledTimes(2);
  });

  it('prunes inactive snapshots while preserving an in-flight build', async () => {
    const checkpoint = deferred<void>();
    vm.checkpoint.mockReturnValueOnce(checkpoint.promise);
    const first = ensureSnapshot();
    await vi.runAllTimersAsync();
    const activeDir = path.dirname(vm.checkpoint.mock.calls[0][0] as string);
    const cacheRoot = path.dirname(activeDir);
    const inactiveDir = path.join(cacheRoot, 'v2-inactive');
    vi.mocked(existsSync).mockImplementation((file) => file === cacheRoot);
    // Put the active build beyond the retention cutoff, so only the pending
    // build guard can protect it. The inactive directory must also be pruned.
    vm.checkpoint.mockImplementationOnce((snapshotPath: string) => {
      const currentDir = path.dirname(snapshotPath);
      cacheFs.readdirSync.mockReturnValue(
        [currentDir, activeDir, inactiveDir].map((directory) => ({
          name: path.basename(directory),
          isDirectory: () => true,
        })),
      );
      cacheFs.statSync.mockImplementation((directory: string) => ({
        mtimeMs: directory === currentDir ? 2 : 1,
      }));
    });

    try {
      await ensureSnapshot({ config: { overlaySize: '4G' }, maxCached: 0 });

      expect(rmSync).toHaveBeenCalledWith(inactiveDir, {
        recursive: true,
        force: true,
      });
      expect(rmSync).not.toHaveBeenCalledWith(activeDir, {
        recursive: true,
        force: true,
      });
    } finally {
      checkpoint.resolve();
      await first;
    }
  });

  it('does not share builds for different snapshot configurations', async () => {
    const setup = deferred<{ exitCode: number }>();
    vm.exec.mockReturnValueOnce(setup.promise);
    const first = ensureSnapshot();
    await vi.runAllTimersAsync();
    const secondPath = await ensureSnapshot({ config: { overlaySize: '4G' } });
    setup.resolve({ exitCode: 0 });
    const firstPath = await first;

    expect(firstPath).not.toBe(secondPath);
    expect(VM.create).toHaveBeenCalledTimes(2);
    expect(vm.checkpoint).toHaveBeenCalledTimes(2);
  });
});
