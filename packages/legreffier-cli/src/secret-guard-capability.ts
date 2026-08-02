import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type SecretGuardCapabilityRunner = () => Promise<void>;

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
  } catch {
    throw new Error(
      'The installed MoltNet CLI does not support `moltnet secrets guard`. ' +
        'Update @themoltnet/cli before installing fail-closed agent hooks.',
    );
  }
}
