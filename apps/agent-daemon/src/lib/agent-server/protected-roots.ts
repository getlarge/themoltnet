import { realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';

/**
 * A worker holds agent and provider keys, so neither a run nor a saved
 * location may use a folder inside, or containing, the MoltNet store or its
 * secrets. Both sides are compared canonically.
 */
export function isProtectedFolder(source: string, roots: string[]): boolean {
  const folder = canonicalOrSelf(source);
  return roots.some((root) => {
    const protectedRoot = canonicalOrSelf(root);
    return within(folder, protectedRoot) || within(protectedRoot, folder);
  });
}

export const PROTECTED_FOLDER_MESSAGE =
  'Choose a folder outside the MoltNet configuration store';

function canonicalOrSelf(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

function within(child: string, parent: string): boolean {
  const suffix = relative(parent, child);
  return (
    suffix === '' ||
    (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`))
  );
}
