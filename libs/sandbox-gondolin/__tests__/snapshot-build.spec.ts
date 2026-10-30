import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureSnapshot } from '../src/snapshot.js';

const vm = vi.hoisted(() => ({
  exec: vi.fn(),
  checkpoint: vi.fn(),
  close: vi.fn(),
}));

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({
  existsSync: () => false,
  mkdirSync: vi.fn(),
  readdirSync: () => [],
  rmSync: vi.fn(),
  statSync: vi.fn(),
}));
vi.mock('@earendil-works/gondolin', () => ({
  createHttpHooks: () => ({ httpHooks: {} }),
  ensureImageSelector: () => ({ assetDir: '/image' }),
  loadGuestAssets: () => ({ rootfsPath: '/image/rootfs.ext4' }),
  VM: { create: () => vm },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
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
