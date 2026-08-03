import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import {
  createWindowsCredentialStore,
  WINDOWS_POWERSHELL_PATH,
} from '../src/windows-credential.js';

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  return child;
}

describe('Windows Credential Manager process', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the absolute system PowerShell with a controlled environment', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const result = createWindowsCredentialStore().read('themolt.net:key');
    child.stdout.write('{"found":false}');
    child.emit('close', 0);

    await expect(result).resolves.toBeNull();
    expect(spawnMock).toHaveBeenCalledWith(
      WINDOWS_POWERSHELL_PATH,
      expect.any(Array),
      expect.objectContaining({
        env: {
          ComSpec: 'C:\\Windows\\System32\\cmd.exe',
          SystemRoot: 'C:\\Windows',
          WINDIR: 'C:\\Windows',
        },
      }),
    );
    expect(WINDOWS_POWERSHELL_PATH).not.toBe('powershell.exe');
  });

  it('kills a process whose output exceeds the fixed bound', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const result = createWindowsCredentialStore().read('themolt.net:key');
    child.stdout.write(Buffer.alloc(64 * 1024 + 1));

    await expect(result).rejects.toThrow(/output exceeded/);
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('kills a process that exceeds the operation deadline', async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const result = createWindowsCredentialStore().read('themolt.net:key');
    const rejection = expect(result).rejects.toThrow(/timed out/);

    await vi.advanceTimersByTimeAsync(30_000);

    await rejection;
    expect(child.kill).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
