import { describe, expect, it, vi } from 'vitest';

import { execManagedCommand } from './managed-exec.js';

function tokenFrom(command: unknown): string {
  if (!Array.isArray(command)) throw new Error('expected argv command');
  const token = command.at(-2);
  if (typeof token !== 'string') throw new Error('missing handshake token');
  return token;
}

function completedProcess(
  exitCode = 0,
  chunks: Array<{ data: Buffer | string; stream: 'stdout' | 'stderr' }> = [],
) {
  return Object.assign(Promise.resolve({ exitCode }), {
    output: async function* () {
      await Promise.resolve();
      yield* chunks;
    },
  });
}

function abortingProcess(
  command: unknown,
  signal: AbortSignal,
  onHandshake: () => void,
) {
  const token = tokenFrom(command);
  const result = new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('exec aborted')), {
      once: true,
    });
  });
  return Object.assign(result, {
    output: async function* () {
      onHandshake();
      yield {
        data: Buffer.from(`MOLTNET_EXEC_PGID:${token}:42\n`),
        stream: 'stdout' as const,
      };
      await result;
    },
  });
}

describe('execManagedCommand', () => {
  it('uses a protected handshake and preserves Buffer chunks', async () => {
    const output = Buffer.from('ok');
    const onData = vi.fn();
    const onStarted = vi.fn();
    const exec = vi.fn((command: unknown) => {
      const token = tokenFrom(command);
      return completedProcess(0, [
        {
          data: `MOLTNET_EXEC_PGID:${token}:42\n`,
          stream: 'stdout',
        },
        { data: output, stream: 'stdout' },
      ]);
    });

    const result = await execManagedCommand({ exec } as never, 'printf ok', {
      cwd: '/workspace',
      onData,
      onStarted,
    });

    expect(result).toEqual({
      exitCode: 0,
      timedOut: false,
      cancelled: false,
      termination: { status: 'not-required' },
    });
    expect(exec).toHaveBeenCalledWith(
      expect.arrayContaining([
        '/bin/sh',
        '-c',
        expect.stringContaining('kill -STOP'),
      ]),
      expect.objectContaining({ cwd: '/workspace', signal: expect.anything() }),
    );
    const launchCommand: unknown = exec.mock.calls[0]?.[0];
    const launchScript = Array.isArray(launchCommand)
      ? launchCommand[2]
      : undefined;
    expect(launchScript).toContain('/proc/$pgid/stat');
    expect(launchScript).not.toContain('.pid');
    expect(onData).toHaveBeenCalledWith(output);
    expect(onData.mock.calls[0]?.[0]).toBe(output);
    expect(onStarted).toHaveBeenCalledOnce();
  });

  it('kills and confirms the guest process group on cancellation', async () => {
    const controller = new AbortController();
    let handshakeEmitted = false;
    const close = vi.fn();
    const exec = vi
      .fn()
      .mockImplementationOnce(
        (command: unknown, options: { signal: AbortSignal }) =>
          abortingProcess(command, options.signal, () => {
            handshakeEmitted = true;
          }),
      )
      .mockImplementationOnce(() => completedProcess(0));
    const pending = execManagedCommand({ exec, close } as never, 'sleep 10', {
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(handshakeEmitted).toBe(true));
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      exitCode: 130,
      cancelled: true,
      termination: { status: 'confirmed', mode: 'process-group' },
    });
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining([
        '/bin/sh',
        '-c',
        expect.stringContaining('kill -KILL'),
        'moltnet-kill',
        '42',
      ]),
    );
    const terminationCommand = exec.mock.calls[1]?.[0];
    const terminationScript = Array.isArray(terminationCommand)
      ? terminationCommand[2]
      : undefined;
    expect(terminationScript).toContain('/proc/[0-9]*/stat');
    expect(terminationScript).toContain('[ "$state" != Z ]');
    expect(close).not.toHaveBeenCalled();
  });

  it('classifies an already exited group without destroying the VM', async () => {
    const controller = new AbortController();
    let handshakeEmitted = false;
    const close = vi.fn();
    const exec = vi
      .fn()
      .mockImplementationOnce(
        (command: unknown, options: { signal: AbortSignal }) =>
          abortingProcess(command, options.signal, () => {
            handshakeEmitted = true;
          }),
      )
      .mockImplementationOnce(() => completedProcess(10));
    const pending = execManagedCommand({ exec, close } as never, 'true', {
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(handshakeEmitted).toBe(true));
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      termination: { status: 'confirmed', mode: 'already-terminated' },
    });
    expect(close).not.toHaveBeenCalled();
  });

  it('returns recovery-required when the group survives SIGKILL', async () => {
    const controller = new AbortController();
    let handshakeEmitted = false;
    const close = vi.fn();
    const exec = vi
      .fn()
      .mockImplementationOnce(
        (command: unknown, options: { signal: AbortSignal }) =>
          abortingProcess(command, options.signal, () => {
            handshakeEmitted = true;
          }),
      )
      .mockImplementationOnce(() => completedProcess(22));
    const pending = execManagedCommand({ exec, close } as never, 'sleep 10', {
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(handshakeEmitted).toBe(true));
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      termination: {
        status: 'recovery-required',
        reason: 'process-group-survived',
      },
    });
    expect(close).not.toHaveBeenCalled();
  });

  it('requires caller recovery when cancellation wins before the handshake', async () => {
    const controller = new AbortController();
    const exec = vi.fn(
      (_command: unknown, options: { signal: AbortSignal }) => {
        const result = new Promise<never>((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => reject(new Error('exec aborted')),
            { once: true },
          );
        });
        return Object.assign(result, {
          output: async function* () {
            await result;
            yield { data: Buffer.alloc(0), stream: 'stdout' as const };
          },
        });
      },
    );
    const pending = execManagedCommand({ exec } as never, 'sleep 10', {
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(exec).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      termination: {
        status: 'recovery-required',
        reason: 'missing-process-group-handshake',
      },
    });
  });

  it('does not start work for a pre-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const exec = vi.fn();

    await expect(
      execManagedCommand({ exec } as never, 'echo unsafe', {
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({
      cancelled: true,
      termination: { status: 'not-started' },
    });
    expect(exec).not.toHaveBeenCalled();
  });
});
