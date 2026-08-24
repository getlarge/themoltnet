import { randomBytes } from 'node:crypto';

import type { VM } from '@earendil-works/gondolin';

const HANDSHAKE_LIMIT_BYTES = 256;
const TERMINATION_TIMEOUT_MS = 5_000;

const TERMINATE_PROCESS_GROUP_SCRIPT = [
  'case "$1" in',
  '  ""|*[!0-9]*) exit 20 ;;',
  'esac',
  'pgid=$1',
  '[ "$pgid" -gt 1 ] || exit 20',
  'group_has_live_process() {',
  '  for stat_file in /proc/[0-9]*/stat; do',
  '    [ -r "$stat_file" ] || continue',
  '    stat=$(cat "$stat_file") || continue',
  '    rest=${stat##*) }',
  '    set -- $rest',
  '    state=$1',
  '    member_pgrp=$3',
  '    if [ "$member_pgrp" = "$pgid" ] && [ "$state" != Z ] && [ "$state" != X ]; then',
  '      return 0',
  '    fi',
  '  done',
  '  return 1',
  '}',
  'if ! group_has_live_process; then exit 10; fi',
  'if ! kill -TERM -"$pgid" 2>/dev/null; then',
  '  if ! group_has_live_process; then exit 10; fi',
  '  exit 21',
  'fi',
  'for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do',
  '  if ! group_has_live_process; then exit 0; fi',
  '  sleep 0.05',
  'done',
  'if ! kill -KILL -"$pgid" 2>/dev/null; then',
  '  if ! group_has_live_process; then exit 0; fi',
  '  exit 21',
  'fi',
  'for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do',
  '  if ! group_has_live_process; then exit 0; fi',
  '  sleep 0.05',
  'done',
  'exit 22',
].join('\n');

export interface ManagedExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  onData?: (data: Buffer) => void;
  onStarted?: () => void;
}

export type ManagedExecTermination =
  | { status: 'not-required' }
  | { status: 'not-started' }
  | {
      status: 'confirmed';
      mode: 'process-group' | 'already-terminated';
    }
  | {
      status: 'recovery-required';
      reason:
        | 'missing-process-group-handshake'
        | 'invalid-process-group-handshake'
        | 'termination-command-failed'
        | 'termination-command-timed-out'
        | 'process-group-survived';
    };

export interface ManagedExecResult {
  exitCode: number;
  timedOut: boolean;
  cancelled: boolean;
  termination: ManagedExecTermination;
}

function wrapInProcessGroup(command: string, token: string): string[] {
  const script = [
    'set -eu',
    'token=$1',
    'command=$2',
    `setsid /bin/sh -c 'kill -STOP "$$"; exec /bin/sh -c "$1"' moltnet-child "$command" &`,
    'pgid=$!',
    'state=',
    'pgrp=',
    'session=',
    'for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do',
    '  if [ -r "/proc/$pgid/stat" ]; then',
    '    stat=$(cat "/proc/$pgid/stat")',
    '    rest=${stat##*) }',
    '    set -- $rest',
    '    state=$1',
    '    pgrp=$3',
    '    session=$4',
    '    if [ "$state" = T ]; then break; fi',
    '  fi',
    '  sleep 0.01',
    'done',
    'if [ "$state" != T ] || [ "$pgrp" != "$pgid" ] || [ "$session" != "$pgid" ] || [ "$pgid" -le 1 ]; then',
    '  kill -KILL -"$pgid" 2>/dev/null || true',
    '  exit 70',
    'fi',
    `printf 'MOLTNET_EXEC_PGID:%s:%s\\n' "$token" "$pgid"`,
    'kill -CONT -"$pgid"',
    'set +e',
    'wait "$pgid"',
    'rc=$?',
    'exit "$rc"',
  ].join('\n');
  return ['/bin/sh', '-c', script, 'moltnet-exec', token, command];
}

function chunkBuffer(data: Buffer | string | Uint8Array): Buffer {
  if (Buffer.isBuffer(data)) return data;
  return typeof data === 'string'
    ? Buffer.from(data, 'utf8')
    : Buffer.from(data);
}

function parseHandshake(
  line: string,
  token: string,
): { pgid?: number; invalid: boolean } {
  const match = new RegExp(`^MOLTNET_EXEC_PGID:${token}:([0-9]+)$`).exec(line);
  if (!match) return { invalid: true };
  const pgid = Number(match[1]);
  return Number.isSafeInteger(pgid) && pgid > 1
    ? { pgid, invalid: false }
    : { invalid: true };
}

async function terminateProcessGroup(
  vm: VM,
  pgid: number,
): Promise<ManagedExecTermination> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('process-group termination timed out'));
  }, TERMINATION_TIMEOUT_MS);
  timer.unref();
  try {
    const result = await vm.exec(
      [
        '/bin/sh',
        '-c',
        TERMINATE_PROCESS_GROUP_SCRIPT,
        'moltnet-kill',
        String(pgid),
      ],
      {
        signal: controller.signal,
        stdout: 'ignore',
        stderr: 'ignore',
      },
    );
    if (result.exitCode === 0) {
      return { status: 'confirmed', mode: 'process-group' };
    }
    if (result.exitCode === 10) {
      return { status: 'confirmed', mode: 'already-terminated' };
    }
    return {
      status: 'recovery-required',
      reason:
        result.exitCode === 22
          ? 'process-group-survived'
          : 'termination-command-failed',
    };
  } catch {
    return {
      status: 'recovery-required',
      reason: timedOut
        ? 'termination-command-timed-out'
        : 'termination-command-failed',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Execute one command in a dedicated guest session/process group. The wrapper
 * stops the child before it can emit output, validates that it is the session
 * leader, and sends the PGID to the host through a nonce-bound handshake.
 * Cancellation never closes the VM here: callers own that recovery decision.
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

  const token = randomBytes(16).toString('hex');
  const controller = new AbortController();
  let timedOut = false;
  let cancelled = false;
  let handshakeBuffer = Buffer.alloc(0);
  let pgid: number | undefined;
  let handshakeInvalid = false;
  const onAbort = (): void => {
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
  timer?.unref();

  try {
    const process = vm.exec(wrapInProcessGroup(command, token), {
      cwd: options.cwd,
      env: options.env,
      signal: controller.signal,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    for await (const chunk of process.output()) {
      const data = chunkBuffer(chunk.data);
      if (pgid !== undefined) {
        options.onData?.(data);
        continue;
      }
      handshakeBuffer = Buffer.concat([handshakeBuffer, data]);
      if (handshakeBuffer.length > HANDSHAKE_LIMIT_BYTES) {
        handshakeInvalid = true;
        controller.abort(new Error('invalid process-group handshake'));
        continue;
      }
      const newline = handshakeBuffer.indexOf(0x0a);
      if (newline === -1) continue;
      const parsed = parseHandshake(
        handshakeBuffer.subarray(0, newline).toString('utf8'),
        token,
      );
      handshakeInvalid = parsed.invalid;
      pgid = parsed.pgid;
      if (handshakeInvalid) {
        controller.abort(new Error('invalid process-group handshake'));
        continue;
      }
      options.onStarted?.();
      const remainder = handshakeBuffer.subarray(newline + 1);
      handshakeBuffer = Buffer.alloc(0);
      if (remainder.length > 0) options.onData?.(remainder);
    }
    const result = await process;
    if (!timedOut && !cancelled) {
      if (handshakeInvalid || pgid === undefined) {
        throw new Error('managed exec did not receive a valid PGID handshake');
      }
      return {
        exitCode: result.exitCode,
        timedOut: false,
        cancelled: false,
        termination: { status: 'not-required' },
      };
    }
  } catch (error) {
    if (!timedOut && !cancelled && !handshakeInvalid) throw error;
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }

  const termination: ManagedExecTermination = handshakeInvalid
    ? {
        status: 'recovery-required',
        reason: 'invalid-process-group-handshake',
      }
    : pgid === undefined
      ? {
          status: 'recovery-required',
          reason: 'missing-process-group-handshake',
        }
      : await terminateProcessGroup(vm, pgid);
  return {
    exitCode: timedOut ? 124 : 130,
    timedOut,
    cancelled: cancelled && !timedOut,
    termination,
  };
}
