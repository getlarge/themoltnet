import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function ensureMoltnetGitignored(
  repoDir: string,
): Promise<boolean> {
  const gitignorePath = join(repoDir, '.gitignore');
  let content = '';
  try {
    content = await readFile(gitignorePath, 'utf-8');
  } catch {
    // Missing .gitignore is fine; create it below.
  }

  if (/^\.moltnet\/?$/m.test(content)) {
    return false;
  }

  const nextContent =
    content.length === 0
      ? '.moltnet/\n'
      : `${content}${content.endsWith('\n') ? '' : '\n'}\n.moltnet/\n`;
  await writeFile(gitignorePath, nextContent, 'utf-8');
  return true;
}
