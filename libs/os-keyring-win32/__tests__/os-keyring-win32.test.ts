import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import keyringConformance from '../../../testdata/keyring-conformance.json';

const { createServerMock, spawnMock } = vi.hoisted(() => ({
  createServerMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawn: spawnMock }));
vi.mock('node:net', () => ({ createServer: createServerMock }));

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

let pipeInput = '';
let listenedPipePath = '';

function configureFakePipeServer(): void {
  createServerMock.mockImplementation(
    (connectionListener: (socket: PassThrough) => void) => {
      const server = new EventEmitter() as EventEmitter & {
        listening: boolean;
        listen: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      server.listening = false;
      server.close = vi.fn(() => {
        server.listening = false;
        return server;
      });
      server.listen = vi.fn((path: string, listeningListener: () => void) => {
        listenedPipePath = path;
        server.listening = true;
        listeningListener();
        const socket = new PassThrough();
        socket.on('data', (chunk) => {
          pipeInput += chunk.toString();
        });
        connectionListener(socket);
        return server;
      });
      return server;
    },
  );
}

describe('Windows keyring provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pipeInput = '';
    listenedPipePath = '';
    configureFakePipeServer();
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

  it('passes the JSON request through an opaque named pipe', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const result = createWindowsCredentialStore().read('themolt.net:key');
    child.stdout.write('{"found":false}');
    child.emit('close', 0);

    await expect(result).resolves.toBeNull();
    expect(listenedPipePath).toMatch(
      /^\\\\\.\\pipe\\moltnet-keyring-[0-9a-f-]+$/,
    );
    expect(pipeInput).toBe('{"operation":"read","target":"themolt.net:key"}\n');
    expect(JSON.stringify(spawnMock.mock.calls[0])).not.toContain(
      'themolt.net:key',
    );
    const powershellArgs = spawnMock.mock.calls[0]?.[1] as string[];
    expect(powershellArgs).toContain('-EncodedCommand');
    const encodedScript = powershellArgs.at(-1);
    expect(typeof encodedScript).toBe('string');
    expect(
      Buffer.from(encodedScript ?? '', 'base64').toString('utf16le'),
    ).toContain('NamedPipeClientStream');
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
        env: expect.objectContaining({
          ComSpec: 'C:\\Windows\\System32\\cmd.exe',
          MOLTNET_KEYRING_PIPE: expect.stringMatching(
            /^moltnet-keyring-[0-9a-f-]+$/,
          ),
          SystemRoot: 'C:\\Windows',
          WINDIR: 'C:\\Windows',
        }),
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
