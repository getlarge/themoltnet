import { randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';

import { readEnvironmentVariable } from './config.js';
import {
  READ_ONLY_CAPABILITIES,
  READ_WRITE_CAPABILITIES,
  type SecretProbeResult,
  type SecretProvider,
  type SecretProviderCapabilities,
} from './secrets.js';

export const FILE_SECRET_PROVIDER = 'file';
export const MOLTNET_SECRET_ROOT_ENV = 'MOLTNET_SECRET_ROOT';
export const MOLTNET_SECRET_ROOT_WRITABLE_ENV = 'MOLTNET_SECRET_ROOT_WRITABLE';
export const MOLTNET_SECRET_MAX_BYTES_ENV = 'MOLTNET_SECRET_MAX_BYTES';
export const DEFAULT_SECRET_MAX_BYTES = 65_536;

const KEY_SEGMENT = /^[A-Za-z0-9._-]+$/;
const GROUP_OTHER_WRITE = 0o022;

export type FileSecretErrorCode =
  | 'provider_unavailable'
  | 'invalid_key'
  | 'symlink_escape'
  | 'unsafe_target'
  | 'oversized'
  | 'read_only';

/** Carries the logical key and a failure class; never file contents. */
export class FileSecretProviderError extends Error {
  constructor(
    readonly code: FileSecretErrorCode,
    readonly key: string,
    detail: string,
  ) {
    super(`file secret ${JSON.stringify(key)}: ${detail} (${code})`);
    this.name = 'FileSecretProviderError';
  }
}

export function validateFileSecretKey(key: string): void {
  const reject = (detail: string): never => {
    throw new FileSecretProviderError('invalid_key', key, detail);
  };
  if (!key) reject('key is empty');
  if (key.includes('\0')) reject('key contains NUL');
  if (key.startsWith('/') || key.startsWith('\\') || /^[A-Za-z]:/.test(key)) {
    reject('key must be relative');
  }
  for (const segment of key.split('/')) {
    if (segment === '') reject('key has an empty segment');
    if (segment === '.' || segment === '..') reject('key must not traverse');
    if (!KEY_SEGMENT.test(segment)) {
      reject('key segments must match [A-Za-z0-9._-]');
    }
  }
}

export interface FileSecretProviderOptions {
  root?: string;
  writable?: boolean;
  maxBytes?: number;
  platform?: NodeJS.Platform;
}

export type EnvironmentLookup = (name: string) => string | undefined;

export function fileSecretProviderOptionsFromEnv(
  readEnv: EnvironmentLookup = readEnvironmentVariable,
  platform: NodeJS.Platform = process.platform,
): FileSecretProviderOptions {
  const root = readEnv(MOLTNET_SECRET_ROOT_ENV)?.trim() || undefined;
  const writable = readEnv(MOLTNET_SECRET_ROOT_WRITABLE_ENV)?.trim() === '1';
  const parsed = Number.parseInt(
    readEnv(MOLTNET_SECRET_MAX_BYTES_ENV) ?? '',
    10,
  );
  const maxBytes =
    Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SECRET_MAX_BYTES;
  return { root, writable, maxBytes, platform };
}

/**
 * Read-only-by-default provider over one trusted directory that an
 * orchestrator projects secrets into (Docker secrets, Kubernetes projected
 * volumes, systemd `LoadCredential`). The root is absolute, comes from
 * runtime configuration, never from `moltnet.json`, and values are resolved
 * on every read so orchestrator rotation needs no restart.
 *
 * Trust assumption: the root and its ancestors are owned by the deployer.
 * Containment is verified by resolving symlinks immediately before each
 * operation; Node has no rooted (`openat`-style) filesystem API, so an
 * adversary who can rewrite links under the root between that check and the
 * access is outside this provider's threat model. The Go CLI enforces the
 * same boundary with `os.Root`.
 */
export class FileSecretProvider implements SecretProvider {
  readonly name = FILE_SECRET_PROVIDER;
  readonly capabilities: SecretProviderCapabilities;
  readonly #root: string | undefined;
  readonly #rootRejected: boolean;
  readonly #writable: boolean;
  readonly #maxBytes: number;
  readonly #platform: NodeJS.Platform;

  constructor(options: FileSecretProviderOptions = {}) {
    const root = options.root?.trim();
    this.#root = root && isAbsolute(root) ? root : undefined;
    this.#rootRejected = Boolean(root) && !isAbsolute(root ?? '');
    this.#writable = options.writable === true;
    this.#maxBytes = options.maxBytes ?? DEFAULT_SECRET_MAX_BYTES;
    this.#platform = options.platform ?? process.platform;
    this.capabilities = this.#writable
      ? READ_WRITE_CAPABILITIES
      : READ_ONLY_CAPABILITIES;
  }

  async read(key: string): Promise<string | null> {
    const target = await this.#resolveExisting(key);
    if (!target) return null;
    const handle = await open(
      target,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
      const info = await handle.stat();
      if (!info.isFile()) {
        throw new FileSecretProviderError(
          'unsafe_target',
          key,
          'not a regular file',
        );
      }
      if (info.size > this.#maxBytes) {
        throw new FileSecretProviderError(
          'oversized',
          key,
          `exceeds ${this.#maxBytes} bytes`,
        );
      }
      const buffer = Buffer.alloc(this.#maxBytes + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > this.#maxBytes) {
        throw new FileSecretProviderError(
          'oversized',
          key,
          `exceeds ${this.#maxBytes} bytes`,
        );
      }
      return stripOneNewline(buffer.subarray(0, bytesRead).toString('utf8'));
    } finally {
      await handle.close();
    }
  }

  async write(key: string, value: string): Promise<void> {
    const root = this.#requireWritable(key);
    const target = resolveFileSecretPath(root, key);
    const existing = await lstatOrNull(target, key);
    if (existing?.isSymbolicLink()) {
      throw new FileSecretProviderError(
        'unsafe_target',
        key,
        'refusing to write through a symlink',
      );
    }
    const ancestorReal = await realpath(
      await firstExistingAncestor(dirname(target)),
    ).catch(() => {
      throw new FileSecretProviderError(
        'unsafe_target',
        key,
        'cannot resolve parent directory',
      );
    });
    assertInsideOrAtRoot(await resolveRoot(root, key), ancestorReal, key);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const temp = `${target}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      const handle = await open(temp, 'wx', 0o600);
      try {
        await handle.writeFile(value);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const root = this.#requireWritable(key);
    const target = resolveFileSecretPath(root, key);
    const existing = await lstatOrNull(target, key);
    if (!existing) return;
    if (!existing.isFile()) {
      throw new FileSecretProviderError(
        'unsafe_target',
        key,
        'refusing to delete a non-regular file',
      );
    }
    // The parent may itself be reached through a symlink; re-verify that it
    // resolves inside the root immediately before unlinking.
    const parentReal = await realpath(dirname(target)).catch(() => {
      throw new FileSecretProviderError(
        'unsafe_target',
        key,
        'cannot resolve parent directory',
      );
    });
    assertInsideOrAtRoot(await resolveRoot(root, key), parentReal, key);
    await unlink(target);
  }

  async probe(key: string): Promise<SecretProbeResult> {
    try {
      return (await this.read(key)) === null ? 'absent' : 'present';
    } catch {
      return 'inaccessible';
    }
  }

  #requireRoot(key: string): string {
    if (!this.#root) {
      throw new FileSecretProviderError(
        'provider_unavailable',
        key,
        this.#rootRejected
          ? `${MOLTNET_SECRET_ROOT_ENV} must be an absolute path`
          : `${MOLTNET_SECRET_ROOT_ENV} is not set`,
      );
    }
    return this.#root;
  }

  #requireWritable(key: string): string {
    this.#requireRoot(key);
    if (!this.#writable) {
      throw new FileSecretProviderError(
        'read_only',
        key,
        `set ${MOLTNET_SECRET_ROOT_WRITABLE_ENV}=1 to allow writes`,
      );
    }
    return this.#root as string;
  }

  /** Real path of an existing, contained, safe regular file; null when absent. */
  async #resolveExisting(key: string): Promise<string | null> {
    const root = this.#requireRoot(key);
    const rootReal = await resolveRoot(root, key);
    const candidate = resolveFileSecretPath(root, key);
    let real: string;
    try {
      real = await realpath(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new FileSecretProviderError(
        'unsafe_target',
        key,
        'cannot resolve path',
      );
    }
    assertStrictlyInsideRoot(rootReal, real, key);
    const info = await stat(real);
    if (!info.isFile()) {
      throw new FileSecretProviderError(
        'unsafe_target',
        key,
        'not a regular file',
      );
    }
    if (this.#platform !== 'win32' && (info.mode & GROUP_OTHER_WRITE) !== 0) {
      throw new FileSecretProviderError(
        'unsafe_target',
        key,
        'group or other write permission set',
      );
    }
    return real;
  }
}

function resolveFileSecretPath(root: string, key: string): string {
  validateFileSecretKey(key);
  const normalizedRoot = resolve(root);
  // Preserve canonical nested keys while making every segment an explicit
  // path-injection sanitizer recognized by static analysis.
  const safeKey = key
    .split('/')
    .map((segment) => basename(segment))
    .join(sep);
  const target = resolve(normalizedRoot, safeKey);
  assertStrictlyInsideRoot(normalizedRoot, target, key);
  return target;
}

async function resolveRoot(root: string, key: string): Promise<string> {
  try {
    return await realpath(root);
  } catch {
    throw new FileSecretProviderError(
      'provider_unavailable',
      key,
      'secret root does not exist',
    );
  }
}

function relativeToRoot(rootReal: string, candidateReal: string): string {
  return relative(rootReal, resolve(candidateReal));
}

function escapesRoot(rel: string): boolean {
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

/** A secret target must be a descendant of the root, never the root itself. */
function assertStrictlyInsideRoot(
  rootReal: string,
  candidateReal: string,
  key: string,
): void {
  const rel = relativeToRoot(rootReal, candidateReal);
  if (rel === '') {
    throw new FileSecretProviderError(
      'symlink_escape',
      key,
      'resolves to the secret root itself',
    );
  }
  if (escapesRoot(rel)) {
    throw new FileSecretProviderError(
      'symlink_escape',
      key,
      'resolves outside the secret root',
    );
  }
}

/** A parent directory may be the root itself or any descendant of it. */
function assertInsideOrAtRoot(
  rootReal: string,
  candidateReal: string,
  key: string,
): void {
  if (escapesRoot(relativeToRoot(rootReal, candidateReal))) {
    throw new FileSecretProviderError(
      'symlink_escape',
      key,
      'resolves outside the secret root',
    );
  }
}

/** `lstat` that treats only ENOENT as "absent"; other failures surface. */
async function lstatOrNull(target: string, key: string) {
  try {
    return await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new FileSecretProviderError(
      'unsafe_target',
      key,
      'cannot inspect target',
    );
  }
}

async function firstExistingAncestor(path: string): Promise<string> {
  let current = path;
  for (;;) {
    const exists = await lstat(current).then(
      () => true,
      () => false,
    );
    if (exists) return current;
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

function stripOneNewline(value: string): string {
  if (value.endsWith('\r\n')) return value.slice(0, -2);
  if (value.endsWith('\n')) return value.slice(0, -1);
  return value;
}
