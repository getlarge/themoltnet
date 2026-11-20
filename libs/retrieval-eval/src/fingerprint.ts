import { readdir, readFile, stat } from 'node:fs/promises';

import { hash } from './hash.js';

export const embeddingSources = [
  'libs/diary-service/src/',
  'libs/embedding-service/src/',
  'libs/retrieval-eval/src/embeddings.ts',
  'libs/retrieval-eval/src/fingerprint.ts',
  'pnpm-lock.yaml',
];
export const evaluationSources = [
  'libs/retrieval-eval/src/',
  'libs/database/src/',
  'libs/diary-service/src/',
  'libs/embedding-service/src/',
  'pnpm-lock.yaml',
];

export async function fingerprintSources(
  paths: string[],
  root = new URL('../../../', import.meta.url),
): Promise<string> {
  async function sourceFiles(path: string): Promise<string[]> {
    if (!(await stat(new URL(path, root))).isDirectory()) return [path];
    const entries = await readdir(new URL(path, root), { withFileTypes: true });
    return (
      await Promise.all(
        entries
          .filter((e) => e.isDirectory() || e.name.endsWith('.ts'))
          .map((e) => sourceFiles(`${path.replace(/\/$/, '')}/${e.name}`)),
      )
    ).flat();
  }
  const files = (await Promise.all(paths.map(sourceFiles))).flat().sort();
  return hash(
    await Promise.all(
      files.map(async (path) => [
        path,
        await readFile(new URL(path, root), 'utf8'),
      ]),
    ),
  );
}
