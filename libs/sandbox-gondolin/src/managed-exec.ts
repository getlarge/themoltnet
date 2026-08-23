import { randomBytes } from 'node:crypto';

import type { VM } from '@earendil-works/gondolin';

const TERMINATION_TIMEOUT_MS = 2_000;

const KILL_PROCESS_GROUP_SCRIPT = [
  'for i in 1 2 3 4 5 6 7 8 9 10; do [ -s "$1" ] && break; sleep 0.05; done',
  'pgid=$(cat "$1" 2>/dev/null) || exit 2',
  'kill -TERM -"$pgid" 2>/dev/null || exit 3',
  'sleep 0.2',
  'kill -KILL -"$pgid" 2>/dev/null || true',
  'for i in 1 2 3 4 5 6 7 8 9 10; do',
  '  if ! kill -0 -"$pgid" 2>/dev/null; then rm -f "$1"; exit 0; fi',
  '  sleep 0.05',
  'done',
  'exit 4',
].join('\n');

export interface ManagedExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  onData?: (data: Buffer) => void;
}

export interface ManagedExecResult {
  exitCode: number;
  timedOut: boolean;
  cancelled: boolean;
  terminationConfirmed?: boolean;
  terminationMode?: 'not-started' | 'process-group' | 'vm-close';
}

function wrapInProcessGroup(command: string, pidFile: string): string[] {
  const script = [
    'set -u',
    'setsid /bin/sh -c "$1" </dev/null &',
    'pid=$!',
    'printf %s "$pid" > "$2"',
    'wait "$pid"',
    'rc=$?',
    'rm -f "$2"',
    'exit "$rc"',
  ].join('\n');
  return ['/bin/sh', '-c', script, 'moltnet-exec', command, pidFile];
}

async function killProcessGroup(
  vm: VM,
  pidFile: string,
): Promise<'process-group' | 'vm-close' | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const kill = Promise.resolve()
    .then(() =>
      vm.exec(
        ['/bin/sh', '-c', KILL_PROCESS_GROUP_SCRIPT, 'moltnet-kill', pidFile],
        { stdout: 'ignore', stderr: 'ignore' },
      ),
    )
    .catch(() => null);
  const timed = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), TERMINATION_TIMEOUT_MS);
  });
  const result = await Promise.race([kill, timed]);
  if (timer) clearTimeout(timer);
  if (result?.exitCode === 0) return 'process-group';

  try {
    await vm.close();
    return 'vm-close';
  } catch {
    return null;
  }
}

/**
 * Execute one guest command in an isolated process group. Gondolin's raw
 * AbortSignal only rejects the host exec session, so timeout/cancellation must
 * explicitly kill the guest process tree and verify termination. If that
 * cannot be proved, the VM is closed as the stronger containment boundary.
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
      terminationConfirmed: true,
      terminationMode: 'not-started',
    };
  }

  const pidFile = `/run/moltnet-exec-${randomBytes(8).toString('hex')}.pid`;
  const controller = new AbortController();
  let timedOut = false;
  let cancelled = false;
  const onAbort = () => {
    cancelled = true;
    controller.abort(options.signal?.reason);
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer =
    options.timeoutMs !== undefined && options.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort(new Error('guest command timed out'));
        }, options.timeoutMs)
      : undefined;

  try {
    const process = vm.exec(wrapInProcessGroup(command, pidFile), {
      cwd: options.cwd,
      env: options.env,
      signal: controller.signal,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    for await (const chunk of process.output()) {
      const data =
        typeof chunk.data === 'string'
          ? Buffer.from(chunk.data, 'utf8')
          : Buffer.from(chunk.data);
      options.onData?.(data);
    }
    const result = await process;
    if (!timedOut && !cancelled) {
      return {
        exitCode: result.exitCode,
        timedOut: false,
        cancelled: false,
      };
    }
  } catch (error) {
    if (!timedOut && !cancelled) throw error;
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }

  const terminationMode = await killProcessGroup(vm, pidFile);
  return {
    exitCode: timedOut ? 124 : 130,
    timedOut,
    cancelled: cancelled && !timedOut,
    terminationConfirmed: terminationMode !== null,
    ...(terminationMode && { terminationMode }),
  };
}
