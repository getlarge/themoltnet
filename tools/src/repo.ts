import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function resolveRepoRoot(): Promise<string> {
  const { stdout } = await execFileAsync('git', [
    'rev-parse',
    '--show-toplevel',
  ]);
  return stdout.trim();
}
