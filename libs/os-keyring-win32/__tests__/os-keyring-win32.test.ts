import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import keyringConformance from '../../../testdata/keyring-conformance.json';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import {
  createPlatformKeyringSecretProvider,
  createWindowsCredentialStore,
  WINDOWS_POWERSHELL_PATH,
  windowsKeyringTarget,
} from '../src/index.js';

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

describe('Windows keyring provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses Go-compatible raw bytes and target', async () => {
    const vector = keyringConformance.windows[0];
    const credentials = {
      read: vi.fn().mockResolvedValue(Buffer.from('secret')),
      write: vi.fn(),
      delete: vi.fn(),
    };
    const provider = createPlatformKeyringSecretProvider(credentials);

    await expect(provider.read(vector.key)).resolves.toBe('secret');
    await provider.write(vector.key, '秘密');
    await provider.delete(vector.key);

    expect(windowsKeyringTarget(vector.service, vector.key)).toBe(
      vector.target,
    );
    expect(credentials.write).toHaveBeenCalledWith(
      vector.target,
      vector.key,
      Buffer.from('秘密'),
    );
  });

  it('passes the script and JSON request through stdin', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    let stdin = '';
    child.stdin.on('data', (chunk) => {
      stdin += chunk.toString();
    });
    const result = createWindowsCredentialStore().read('themolt.net:key');
    child.stdout.write('{"found":false}');
    child.emit('close', 0);

    await expect(result).resolves.toBeNull();
    const [encodedScript, request, trailing] = stdin.split('\n');
    expect(encodedScript).toBeTruthy();
    expect(Buffer.from(encodedScript, 'base64').toString('utf8')).toContain(
      '[Console]::In.ReadLine() | ConvertFrom-Json',
    );
    expect(request).toBe('{"operation":"read","target":"themolt.net:key"}');
    expect(trailing).toBe('');
    expect(spawnMock.mock.calls[0]?.[1]).not.toContain(encodedScript);
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
