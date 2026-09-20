import { createHash } from 'node:crypto';
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export interface StoreRootOptions {
  /** The store itself, not an OS home or an identity directory. */
  root?: string;
  cwd?: string;
  home?: string;
  env?: Readonly<Record<string, string | undefined>>;
}

/** Resolve existing ancestors without creating anything or following a broken link. */
export function canonicalStoreRoot(root: string, cwd = process.cwd()): string {
  if (!root.trim() || root.includes('\u0000')) {
    throw new Error('MoltNet store root must be a nonempty directory path');
  }
  let ancestor = resolve(cwd, root);
  const missing: string[] = [];
  for (;;) {
    try {
      lstatSync(ancestor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.unshift(basename(ancestor));
      ancestor = parent;
      continue;
    }
    const canonical = realpathSync(ancestor);
    if (!statSync(canonical).isDirectory()) {
      throw new Error('MoltNet store root must be a directory');
    }
    return join(canonical, ...missing);
  }
}

/** Explicit root > MOLTNET_HOME > the established user-local default. */
export function resolveStoreRoot(options: StoreRootOptions = {}): string {
  // This is the shared configuration boundary for store selection.
  // eslint-disable-next-line no-restricted-syntax
  const env = options.env ?? process.env;
  const root = options.root ?? env.MOLTNET_HOME;
  // Keep the public default path unchanged. Consumers needing a canonical
  // lock/namespace identity use canonicalStoreRoot on this same selection.
  if (root === undefined)
    return join(options.home ?? homedir(), '.config', 'moltnet');
  return canonicalStoreRoot(root, options.cwd);
}

/** The established default service remains readable without copying secrets. */
export function storeSecretService(options: StoreRootOptions = {}): string {
  const root = canonicalStoreRoot(resolveStoreRoot(options), options.cwd);
  const defaultRoot = canonicalStoreRoot(
    join(options.home ?? homedir(), '.config', 'moltnet'),
    options.cwd,
  );
  if (root === defaultRoot) return 'themolt.net';
  const digest = createHash('sha256').update(root, 'utf8').digest('hex');
  return `themolt.net/store/${digest}`;
}
