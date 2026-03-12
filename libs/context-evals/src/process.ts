import { exec, type ExecException, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface CommandResult {
  passed: boolean;
  output: string;
}

function isExecException(error: unknown): error is ExecException & {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
} {
  return typeof error === 'object' && error !== null;
}

function toText(value: string | Buffer | undefined): string {
  if (typeof value === 'string') return value;
  if (value instanceof Buffer) return value.toString('utf8');
  return '';
}

export async function execFileText(
  file: string,
  args: string[],
  options: {
    cwd?: string;
    timeout?: number;
  } = {},
): Promise<string> {
  const { stdout } = await execFileAsync(file, args, {
    cwd: options.cwd,
    timeout: options.timeout,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

export async function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs = 300_000,
): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeoutMs,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return { passed: true, output: `${stdout}${stderr}` };
  } catch (error: unknown) {
    if (isExecException(error)) {
      return {
        passed: false,
        output: `${toText(error.stdout)}${toText(error.stderr)}`,
      };
    }
    throw error;
  }
}
