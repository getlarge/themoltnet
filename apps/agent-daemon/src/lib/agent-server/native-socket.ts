import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

/** The supervisor owns the private directory; the server never removes peers. */
export async function validateNativeSocket(path: string): Promise<void> {
  if (!isAbsolute(path) || Buffer.byteLength(path) > 100) {
    throw new Error(
      'Native socket must be an absolute path of at most 100 bytes',
    );
  }
  const parent = dirname(path);
  const metadata = await lstat(parent);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o777) !== 0o700 ||
    (await realpath(parent)) !== resolve(parent)
  ) {
    throw new Error(
      'Native socket requires a private, owned directory without symlinks',
    );
  }
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error('Native socket path already exists; it was left untouched');
}
