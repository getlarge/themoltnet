import type * as FsPromises from 'node:fs/promises';
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileSecretProvider } from '../src/file-secret-provider.js';

/**
 * Forces the interleaving "containment check passes → link swapped → unlink"
 * by wrapping `unlink`. Everything else is the real filesystem.
 */
const hooks = vi.hoisted(() => ({
  beforeUnlink: undefined as undefined | (() => Promise<void>),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    unlink: async (path: Parameters<typeof actual.unlink>[0]) => {
      await hooks.beforeUnlink?.();
      return actual.unlink(path);
    },
  };
});

const tempDirs: string[] = [];
async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'moltnet-secret-race-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  hooks.beforeUnlink = undefined;
  await Promise.all(
    tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

describe('FileSecretProvider check/use limitation (documented, not fixed)', () => {
  it('does not prevent a link swap between the containment check and unlink', async () => {
    // Node has no rooted (openat-style) filesystem API. The provider verifies
    // that the parent resolves inside the root immediately before unlinking,
    // but a party that can rewrite links under the root in that window can
    // redirect the unlink. That party is outside the threat model (the root
    // is deployer-owned); this test pins the limitation so a future change
    // that closes it — or a regression that widens it — is visible.
    const root = await tempRoot();
    const outside = await tempRoot();
    await mkdir(join(root, 'd'), { mode: 0o700 });
    await writeFile(join(root, 'd', 'k'), 'inside', { mode: 0o600 });
    await writeFile(join(outside, 'k'), 'outside', { mode: 0o600 });
    const provider = new FileSecretProvider({
      root,
      writable: true,
      platform: process.platform,
    });

    hooks.beforeUnlink = async () => {
      // Containment already passed on the real directory `d`; swap it for a
      // link that escapes the root before the unlink lands.
      await rename(join(root, 'd'), join(root, 'd.moved'));
      await symlink(outside, join(root, 'd'));
    };

    await expect(provider.delete('d/k')).resolves.toBeUndefined();

    // Limitation: the outside file is what got removed.
    await expect(stat(join(outside, 'k'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(stat(join(root, 'd.moved', 'k'))).resolves.toBeDefined();
  });

  it('is not exploitable when the swap happens before the containment check', async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    await writeFile(join(outside, 'k'), 'outside', { mode: 0o600 });
    await symlink(outside, join(root, 'd'));
    const provider = new FileSecretProvider({
      root,
      writable: true,
      platform: process.platform,
    });

    await expect(provider.delete('d/k')).rejects.toMatchObject({
      code: 'symlink_escape',
    });
    await expect(stat(join(outside, 'k'))).resolves.toBeDefined();
  });
});
