import { describe, expect, it, vi } from 'vitest';

import { execManagedCommand } from './managed-exec.js';

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

function pendingProcess() {
  const pending = new Promise<never>(() => {
    // Deliberately unsettled: VM retirement must not wait on guest behavior.
  });
  return Object.assign(pending, {
    output: async function* () {
      await pending;
      yield { data: Buffer.alloc(0), stream: 'stdout' as const };
    },
  });
}

describe('execManagedCommand', () => {
  it('preserves login-shell behavior and distinguishes output streams', async () => {
    const stdout = Buffer.from('ok');
    const onData = vi.fn();
    const onStarted = vi.fn();
    const exec = vi.fn(() =>
      completedProcess(0, [
        { data: stdout, stream: 'stdout' },
        { data: 'warning', stream: 'stderr' },
      ]),
    );

    const result = await execManagedCommand({ exec } as never, 'printf ok', {
      cwd: '/workspace',
      env: { EXAMPLE: 'value' },
      onData,
      onStarted,
    });

    expect(result).toEqual({
      exitCode: 0,
      timedOut: false,
      cancelled: false,
      termination: { status: 'not-required' },
    });
    expect(exec).toHaveBeenCalledWith(['/bin/sh', '-lc', 'printf ok'], {
      cwd: '/workspace',
      env: { EXAMPLE: 'value' },
      signal: expect.any(AbortSignal),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(onData).toHaveBeenNthCalledWith(1, stdout, 'stdout');
    expect(onData).toHaveBeenNthCalledWith(2, Buffer.from('warning'), 'stderr');
    expect(onStarted).toHaveBeenCalledOnce();
  });

  it('retires the VM on cancellation even when guest execution never settles', async () => {
    const controller = new AbortController();
    const close = vi.fn().mockResolvedValue(undefined);
    const onDiagnostic = vi.fn();
    const exec = vi.fn(() => pendingProcess());
    const pending = execManagedCommand(
      { exec, close } as never,
      'setsid sh -c "sleep 300" & wait',
      {
        signal: controller.signal,
        onDiagnostic,
      },
    );

    await vi.waitFor(() => expect(exec).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).resolves.toEqual({
      exitCode: 130,
      timedOut: false,
      cancelled: true,
      termination: { status: 'backend-retired', mode: 'vm-close' },
    });
    expect(exec).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(onDiagnostic).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        event: 'managed_exec.backend_retirement',
        trigger: 'cancellation',
        outcome: 'started',
      }),
    );
    expect(onDiagnostic).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ outcome: 'succeeded' }),
    );
  });

  it('drives the internal timeout path and retires the VM', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const exec = vi.fn(() => pendingProcess());

    await expect(
      execManagedCommand({ exec, close } as never, 'sleep 300', {
        timeoutMs: 5,
      }),
    ).resolves.toEqual({
      exitCode: 124,
      timedOut: true,
      cancelled: false,
      termination: { status: 'backend-retired', mode: 'vm-close' },
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it('fails closed when host-side VM retirement fails', async () => {
    const controller = new AbortController();
    const close = vi
      .fn()
      .mockRejectedValue(new Error('hypervisor unavailable'));
    const onDiagnostic = vi.fn();
    const exec = vi.fn(() => pendingProcess());
    const pending = execManagedCommand({ exec, close } as never, 'sleep 300', {
      signal: controller.signal,
      onDiagnostic,
    });

    await vi.waitFor(() => expect(exec).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      termination: {
        status: 'recovery-required',
        reason: 'backend-retirement-failed',
      },
    });
    expect(onDiagnostic).toHaveBeenLastCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        message: expect.stringContaining('hypervisor unavailable'),
      }),
    );
  });

  it('does not start or retire a VM for a pre-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const exec = vi.fn();
    const close = vi.fn();

    await expect(
      execManagedCommand({ exec, close } as never, 'echo unsafe', {
        signal: controller.signal,
      }),
    ).resolves.toEqual({
      exitCode: 130,
      timedOut: false,
      cancelled: true,
      termination: { status: 'not-started' },
    });
    expect(exec).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
