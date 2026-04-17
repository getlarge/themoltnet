import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function fetchRenderedPack(opts: {
  packId: string;
  credentials: string;
}): Promise<string> {
  const { stdout } = await execFileAsync(
    'moltnet',
    [
      'rendered-packs',
      'get',
      '--id',
      opts.packId,
      '--credentials',
      opts.credentials,
    ],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout) as { content?: string; body?: string };
  const content = parsed.content ?? parsed.body;
  if (!content) {
    throw new Error(`rendered pack ${opts.packId} has no content field`);
  }
  return content;
}
