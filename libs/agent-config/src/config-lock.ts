import {
  lstat,
  mkdir,
  realpath,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';

/**
 * Shared with Go safefile.Acquire: canonical parent + basename + .writer-lock.
 * No lease expiry: a paused writer must never lose its exclusive ownership.
 * Readers need no lock because writers commit via atomic rename.
 */
export async function withConfigLock<T>(
  path: string,
  work: () => Promise<T>,
  timeoutMs = 5000,
): Promise<T> {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
  const canonical = join(await realpath(dirname(absolute)), basename(absolute));
  const lock = `${canonical}.writer-lock`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await mkdir(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) {
        throw new Error(
          `Config writer lock busy: ${lock}. If a writer crashed, confirm no writer is running before removing this directory.`,
        );
      }
      await setTimeout(25);
    }
  }
  try {
    await writeFile(join(lock, 'owner'), `${process.pid}\n`, { mode: 0o600 });
    try {
      const info = await lstat(canonical);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error('Config must be a regular file, not a symbolic link');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return await work();
  } finally {
    await unlink(join(lock, 'owner')).catch(() => undefined);
    await rmdir(lock);
  }
}
