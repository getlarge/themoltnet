import { describe, expect, it, vi } from 'vitest';

import { execManagedCommand } from './managed-exec.js';

function completedProcess(exitCode = 0, chunks: string[] = []) {
  return Object.assign(Promise.resolve({ exitCode }), {
    output: async function* () {
      await Promise.resolve();
      for (const data of chunks) yield { data, stream: 'stdout' };
    },
  });
}

function abortingProcess(signal: AbortSignal) {
  const result = new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('exec aborted')), {
      once: true,
    });
  });
  return Object.assign(result, {
    output: async function* () {
      await result;
      yield { data: '', stream: 'stdout' };
    },
  });
}

describe('execManagedCommand', () => {
  it('runs a command as its own guest process group', async () => {
    const onData = vi.fn();
    const exec = vi.fn(() => completedProcess(0, ['ok']));
    const result = await execManagedCommand({ exec } as never, 'printf ok', {
      cwd: '/workspace',
      onData,
    });

    expect(result).toEqual({
      exitCode: 0,
      timedOut: false,
      cancelled: false,
    });
    expect(exec).toHaveBeenCalledWith(
      expect.arrayContaining([
        '/bin/sh',
        '-c',
        expect.stringContaining('setsid /bin/sh'),
      ]),
      expect.objectContaining({ cwd: '/workspace', signal: expect.anything() }),
    );
    expect(onData).toHaveBeenCalledWith(Buffer.from('ok'));
  });

  it('kills and confirms the guest process group on cancellation', async () => {
    const controller = new AbortController();
    const exec = vi
      .fn()
      .mockImplementationOnce(
        (_command: unknown, options: { signal: AbortSignal }) =>
          abortingProcess(options.signal),
      )
      .mockImplementationOnce(() => completedProcess(0));
    const pending = execManagedCommand(
      { exec, close: vi.fn() } as never,
      'sleep 10',
      { signal: controller.signal },
    );

    await vi.waitFor(() => expect(exec).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      exitCode: 130,
      cancelled: true,
      terminationConfirmed: true,
      terminationMode: 'process-group',
    });
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining([
        '/bin/sh',
        '-c',
        expect.stringContaining('kill -KILL'),
      ]),
    );
  });

  it('closes the VM when process-group termination cannot be confirmed', async () => {
    const controller = new AbortController();
    const close = vi.fn().mockResolvedValue(undefined);
    const exec = vi
      .fn()
      .mockImplementationOnce(
        (_command: unknown, options: { signal: AbortSignal }) =>
          abortingProcess(options.signal),
      )
      .mockImplementationOnce(() => completedProcess(3));
    const pending = execManagedCommand({ exec, close } as never, 'sleep 10', {
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(exec).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      terminationConfirmed: true,
      terminationMode: 'vm-close',
    });
    expect(close).toHaveBeenCalledOnce();
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
      terminationConfirmed: true,
      terminationMode: 'not-started',
    });
    expect(exec).not.toHaveBeenCalled();
  });
});
