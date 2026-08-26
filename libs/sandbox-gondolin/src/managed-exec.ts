import type { VM } from '@earendil-works/gondolin';

export interface ManagedExecDiagnostic {
  event: 'managed_exec.backend_retirement';
  trigger: 'cancellation' | 'timeout';
  outcome: 'started' | 'succeeded' | 'failed';
  message: string;
}

export interface ManagedExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  onData?: (data: Buffer, stream: 'stdout' | 'stderr') => void;
  onDiagnostic?: (diagnostic: ManagedExecDiagnostic) => void;
  onStarted?: () => void;
}

export type ManagedExecTermination =
  | { status: 'not-required' }
  | { status: 'not-started' }
  | { status: 'backend-retired'; mode: 'vm-close' }
  | {
      status: 'recovery-required';
      reason: 'backend-retirement-failed';
    };

export interface ManagedExecResult {
  exitCode: number;
  timedOut: boolean;
  cancelled: boolean;
  termination: ManagedExecTermination;
}

function chunkBuffer(data: Buffer | string | Uint8Array): Buffer {
  if (Buffer.isBuffer(data)) return data;
  return typeof data === 'string'
    ? Buffer.from(data, 'utf8')
    : Buffer.from(data);
}

async function retireBackend(
  vm: VM,
  trigger: 'cancellation' | 'timeout',
  onDiagnostic?: (diagnostic: ManagedExecDiagnostic) => void,
): Promise<ManagedExecTermination> {
  onDiagnostic?.({
    event: 'managed_exec.backend_retirement',
    trigger,
    outcome: 'started',
    message: 'retiring Gondolin VM after interrupted guest execution',
  });
  try {
    await vm.close();
    onDiagnostic?.({
      event: 'managed_exec.backend_retirement',
      trigger,
      outcome: 'succeeded',
      message: 'Gondolin VM retirement completed',
    });
    return { status: 'backend-retired', mode: 'vm-close' };
  } catch (error) {
    onDiagnostic?.({
      event: 'managed_exec.backend_retirement',
      trigger,
      outcome: 'failed',
      message:
        error instanceof Error
          ? `Gondolin VM retirement failed: ${error.message}`
          : 'Gondolin VM retirement failed',
    });
    return {
      status: 'recovery-required',
      reason: 'backend-retirement-failed',
    };
  }
}

/**
 * Execute one login-shell command in a Gondolin VM. Successful commands may
 * reuse the VM. Timeout or cancellation retires the complete VM through the
 * host API before returning, because no guest process/session boundary can
 * prove containment against daemonization or a guest-mutated root filesystem.
 */
export async function execManagedCommand(
  vm: VM,
  command: string,
  options: ManagedExecOptions = {},
): Promise<ManagedExecResult> {
  if (options.signal?.aborted) {
    return {
      exitCode: 130,
      timedOut: false,
      cancelled: true,
      termination: { status: 'not-started' },
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  let cancelled = false;
  let executionSettled = false;
  let acceptOutput = true;
  let resolveInterrupted: (() => void) | undefined;
  let retirementPromise: Promise<ManagedExecTermination> | undefined;
  const interrupted = new Promise<void>((resolve) => {
    resolveInterrupted = resolve;
  });
  const interrupt = (trigger: 'cancellation' | 'timeout'): void => {
    if (executionSettled || retirementPromise) return;
    acceptOutput = false;
    controller.abort(new Error(`guest command interrupted by ${trigger}`));
    retirementPromise = retireBackend(vm, trigger, options.onDiagnostic);
    resolveInterrupted?.();
  };
  const onAbort = (): void => {
    cancelled = true;
    interrupt('cancellation');
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer =
    options.timeoutMs !== undefined && options.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          interrupt('timeout');
        }, options.timeoutMs)
      : undefined;
  timer?.unref();

  try {
    const process = vm.exec(['/bin/sh', '-lc', command], {
      cwd: options.cwd,
      env: options.env,
      signal: controller.signal,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    options.onStarted?.();
    const execution = (async () => {
      for await (const chunk of process.output()) {
        if (!acceptOutput) continue;
        options.onData?.(chunkBuffer(chunk.data), chunk.stream);
      }
      return process;
    })();
    const observedExecution = execution.then(
      (result) => {
        executionSettled = true;
        return { kind: 'result' as const, result };
      },
      (error: unknown) => {
        executionSettled = true;
        return { kind: 'error' as const, error };
      },
    );
    const first = await Promise.race([
      observedExecution,
      interrupted.then(() => ({ kind: 'interrupted' as const })),
    ]);

    if (first.kind === 'result' && !timedOut && !cancelled) {
      return {
        exitCode: first.result.exitCode,
        timedOut: false,
        cancelled: false,
        termination: { status: 'not-required' },
      };
    }
    if (first.kind === 'error' && !timedOut && !cancelled) {
      throw first.error;
    }

    void execution.catch(() => undefined);
    const trigger = timedOut ? 'timeout' : 'cancellation';
    const termination = await (retirementPromise ??= retireBackend(
      vm,
      trigger,
      options.onDiagnostic,
    ));
    return {
      exitCode: timedOut ? 124 : 130,
      timedOut,
      cancelled: cancelled && !timedOut,
      termination,
    };
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
