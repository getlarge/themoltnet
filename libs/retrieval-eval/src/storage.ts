import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { environment } from './config.js';

export function workspacePath(
  id = 'themoltnet',
  override = environment.workspace,
): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid workspace ID');
  return override
    ? resolve(override)
    : join(homedir(), '.local/share/moltnet/retrieval-eval', id);
}
export async function saveJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2) + '\n');
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temp, path);
}
export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}
