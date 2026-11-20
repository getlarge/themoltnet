import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import lockfile from 'proper-lockfile';

/** Every reader takes the same renewable cross-process lock, including cache hits. */
export async function ensureCachedSnapshot(
  path: string,
  build: (pendingPath: string) => Promise<unknown>,
): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  const release = await lockfile.lock(path, {
    realpath: false,
    stale: 60_000,
    update: 10_000,
    retries: { retries: 900, minTimeout: 100, maxTimeout: 2_000, factor: 1.2 },
  });
  const pending = `${path}.building-${process.pid}-${randomUUID()}`;
  try {
    // No live builder can own these private files while we hold the lock.
    for (const name of await readdir(dirname(path)))
      if (name.startsWith(basename(path) + '.building-'))
        await rm(join(dirname(path), name), { recursive: true, force: true });
    if (!existsSync(path)) {
      await build(pending);
      // A killed builder leaves only its private temporary file, never a cache hit.
      await rename(pending, path);
    }
    return path;
  } finally {
    await rm(pending, { force: true, recursive: true });
    await release();
  }
}
