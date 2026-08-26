import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandExecutionFailureKind =
  | 'aborted'
  | 'output-overflow'
  | 'spawn-error'
  | 'timed-out';

/**
 * A command that never produced a trustworthy process exit code.
 *
 * Callers may interpret a non-zero CommandResult as guest/backend behavior.
 * They must not interpret transport, timeout, or abort failures that way, so
 * those outcomes reject with this distinct error instead.
 */
export class CommandExecutionError extends Error {
  constructor(
    readonly kind: CommandExecutionFailureKind,
    readonly details: {
      code: number | string | null;
      killed: boolean;
      signal: NodeJS.Signals | null;
      stderr: string;
      stdout: string;
    },
  ) {
    super(
      `command ${kind}: ${details.stderr || String(details.code ?? details.signal ?? 'unknown')}`,
    );
    this.name = 'CommandExecutionError';
  }
}

export type CommandExecutor = (
  command: string,
  args: string[],
  options?: { signal?: AbortSignal; timeoutMs?: number },
) => Promise<CommandResult>;

export const executeCommand: CommandExecutor = async (
  command,
  args,
  options = {},
) => {
  try {
    const result = await execFileAsync(command, args, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      signal: options.signal,
      timeout: options.timeoutMs ?? 30_000,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as Error & {
      code?: number | string | null;
      killed?: boolean;
      signal?: NodeJS.Signals | null;
      stdout?: string;
      stderr?: string;
    };
    if (typeof failure.code !== 'number') {
      const kind: CommandExecutionFailureKind =
        failure.code === 'ABORT_ERR' || options.signal?.aborted
          ? 'aborted'
          : failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
            ? 'output-overflow'
            : failure.killed
              ? 'timed-out'
              : 'spawn-error';
      throw new CommandExecutionError(kind, {
        code: failure.code ?? null,
        killed: failure.killed ?? false,
        signal: failure.signal ?? null,
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? failure.message,
      });
    }
    return {
      exitCode: failure.code,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? failure.message,
    };
  }
};
