import { createHash } from 'node:crypto';
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse, sep } from 'node:path';

export const MOLTNET_SECRET_SERVICE = 'themolt.net';

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
  // Walk in filesystem order: resolving `link/..` lexically can select a
  // different directory from the OS when link points into another tree.
  const absolute = isAbsolute(root) ? root : `${cwd}${sep}${root}`;
  const prefix = parse(absolute).root;
  let current = realpathSync.native(prefix);
  for (const segment of absolute
    .slice(prefix.length)
    .split(sep === '/' ? '/' : /[\\/]/)) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      current = dirname(current);
      continue;
    }
    current = join(current, segment);
    try {
      lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    current = realpathSync.native(current);
    if (!statSync(current).isDirectory()) {
      throw new Error('MoltNet store root must be a directory');
    }
  }
  return current;
}

/** Explicit root > MOLTNET_HOME (or its full-store alias) > user-local default. */
export function resolveStoreRoot(options: StoreRootOptions = {}): string {
  return resolveStoreSelection(options).root;
}

/** Store selection together with its diagnostic provenance. */
export function resolveStoreSelection(options: StoreRootOptions = {}): {
  root: string;
  source: string;
} {
  // This is the shared configuration boundary for store selection.
  // eslint-disable-next-line no-restricted-syntax
  const env = options.env ?? process.env;
  if (
    options.root === undefined &&
    env.MOLTNET_HOME !== undefined &&
    env.MOLTNET_AGENT_SERVER_ROOT !== undefined &&
    canonicalStoreRoot(env.MOLTNET_HOME, options.cwd) !==
      canonicalStoreRoot(env.MOLTNET_AGENT_SERVER_ROOT, options.cwd)
  ) {
    throw new Error(
      `Conflicting MOLTNET_HOME=${JSON.stringify(env.MOLTNET_HOME)} and MOLTNET_AGENT_SERVER_ROOT=${JSON.stringify(env.MOLTNET_AGENT_SERVER_ROOT)}; select one store root`,
    );
  }
  const root =
    options.root ?? env.MOLTNET_HOME ?? env.MOLTNET_AGENT_SERVER_ROOT;
  const source =
    options.root !== undefined
      ? 'explicit root'
      : env.MOLTNET_HOME !== undefined
        ? 'MOLTNET_HOME'
        : env.MOLTNET_AGENT_SERVER_ROOT !== undefined
          ? 'MOLTNET_AGENT_SERVER_ROOT'
          : 'default root';
  if (root === undefined) {
    // Preserve the established config/display path without filesystem access.
    return {
      root: join(options.home ?? homedir(), '.config', 'moltnet'),
      source,
    };
  }

  try {
    return { root: canonicalStoreRoot(root, options.cwd), source };
  } catch (cause) {
    throw new Error(
      `Invalid MoltNet store root (${source}): ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

/** Parent-process default used only for namespace comparison across worker HOME changes. */
export function defaultStoreRoot(options: StoreRootOptions = {}): string {
  // eslint-disable-next-line no-restricted-syntax
  const inherited = (options.env ?? process.env).MOLTNET_DEFAULT_STORE_ROOT;
  if (inherited !== undefined) {
    if (!isAbsolute(inherited) || inherited.includes('\u0000')) {
      throw new Error(
        'MOLTNET_DEFAULT_STORE_ROOT must be an absolute directory path',
      );
    }
    return inherited;
  }
  return join(options.home ?? homedir(), '.config', 'moltnet');
}

/** Compare store identity, including aliases of the default directory. */
export function isDefaultStore(options: StoreRootOptions = {}): boolean {
  // eslint-disable-next-line no-restricted-syntax
  const env = options.env ?? process.env;
  if (
    options.root === undefined &&
    env.MOLTNET_HOME === undefined &&
    env.MOLTNET_AGENT_SERVER_ROOT === undefined
  )
    return true;
  const root = resolveStoreRoot(options);
  const defaultRoot = defaultStoreRoot(options);
  try {
    return (
      canonicalStoreRoot(root, options.cwd) ===
      canonicalStoreRoot(defaultRoot, options.cwd)
    );
  } catch {
    // A valid isolated store does not depend on the default store's health.
    return false;
  }
}

/** The established default service remains readable without copying secrets. */
export function storeSecretService(options: StoreRootOptions = {}): string {
  if (isDefaultStore(options)) return MOLTNET_SECRET_SERVICE;
  const root = resolveStoreRoot(options);
  const digest = createHash('sha256').update(root, 'utf8').digest('hex');
  return `${MOLTNET_SECRET_SERVICE}/store/${digest}`;
}
