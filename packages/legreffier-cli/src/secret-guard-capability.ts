import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type SecretGuardCapabilityRunner = () => Promise<void>;

interface ProcessError extends Error {
  code?: string | number;
  killed?: boolean;
  signal?: string;
  stderr?: string;
}

async function runSecretGuardHelp(): Promise<void> {
  await execFileAsync('moltnet', ['secrets', 'guard', '--help'], {
    timeout: 5_000,
  });
}

export async function assertSecretGuardCapability(
  run: SecretGuardCapabilityRunner = runSecretGuardHelp,
): Promise<void> {
  try {
    await run();
  } catch (cause) {
    const error = cause as ProcessError;
    if (error.code === 'ENOENT') {
      throw new Error(
        'The MoltNet CLI was not found on PATH. Install the latest ' +
          '@themoltnet/cli before running LeGreffier setup.',
        { cause },
      );
    }
    if (error.code === 'EACCES') {
      throw new Error('The MoltNet CLI on PATH is not executable.', { cause });
    }
    if (
      error.killed ||
      error.signal === 'SIGTERM' ||
      error.code === 'ETIMEDOUT'
    ) {
      throw new Error(
        'Timed out while checking the installed MoltNet CLI capability.',
        { cause },
      );
    }
    throw new Error(
      'The installed MoltNet CLI does not support `moltnet secrets guard`. ' +
        'Update @themoltnet/cli before installing fail-closed agent hooks.',
      { cause },
    );
  }
}
