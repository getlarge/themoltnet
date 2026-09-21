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
  if (metadata.isSymbolicLink())
    throw new Error(`Native socket parent contains a symlink: ${parent}`);
  if (!metadata.isDirectory())
    throw new Error(`Native socket parent is not a directory: ${parent}`);
  const expectedUid = process.getuid?.();
  if (expectedUid === undefined || metadata.uid !== expectedUid)
    throw new Error(
      `Native socket parent has uid ${metadata.uid}; expected ${String(expectedUid)}: ${parent}`,
    );
  const mode = metadata.mode & 0o777;
  if (mode !== 0o700)
    throw new Error(
      `Native socket parent has mode ${mode.toString(8)}; expected 700: ${parent}`,
    );
  const canonical = await realpath(parent);
  if (canonical !== resolve(parent))
    throw new Error(
      `Native socket parent contains a symlink: ${parent} resolves to ${canonical}`,
    );
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error('Native socket path already exists; it was left untouched');
}
