import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveEnvSecretReference } from '@themoltnet/sdk';
import { createNodeSecretProviderRegistry } from '@themoltnet/sdk/node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../config.js';
import { resolveExecutorSigningPrivateKey } from './executor-attestation.js';

/**
 * No mocks: exercises the daemon's startup material resolution through the
 * real Node secret-provider registry and the real `file` provider, for both
 * references the configless agent-key mode requires.
 */
describe('agent-key mode with file references (integration)', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(
      dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
    );
  });

  async function secretRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'daemon-secret-root-'));
    dirs.push(root);
    return root;
  }

  it('resolves both references from MOLTNET_SECRET_ROOT before any claim work', async () => {
    const root = await secretRoot();
    const seed = Buffer.alloc(32, 9).toString('base64');
    await writeFile(join(root, 'agent-key.id-1'), 'ak_from_file\n', {
      mode: 0o400,
    });
    await mkdir(join(root, 'identity'), { mode: 0o700 });
    await writeFile(join(root, 'identity', 'fp.seed'), `${seed}\n`, {
      mode: 0o400,
    });
    vi.stubEnv('MOLTNET_SECRET_ROOT', root);
    vi.stubEnv('MOLTNET_AGENT_KEY', '');
    vi.stubEnv('MOLTNET_AGENT_KEY_REF', 'file:agent-key.id-1');
    vi.stubEnv('MOLTNET_PRIVATE_KEY', '');
    vi.stubEnv('MOLTNET_PRIVATE_KEY_REF', 'file:identity/fp.seed');

    const cfg = loadConfig();
    expect(cfg.authMode).toBe('agent-key');

    await expect(
      resolveExecutorSigningPrivateKey({
        authMode: cfg.authMode,
        agentDir: '/nonexistent/agent',
        configuredPrivateKey: cfg.signingPrivateKey,
        configuredPrivateKeyRef: cfg.signingPrivateKeyRef,
      }),
    ).resolves.toBe(seed);
    await expect(
      resolveEnvSecretReference(
        'file:agent-key.id-1',
        createNodeSecretProviderRegistry(),
      ),
    ).resolves.toBe('ak_from_file');
  });

  it('stops startup on a malformed seed and on an unreadable or missing reference', async () => {
    const root = await secretRoot();
    await writeFile(join(root, 'identity.fp.seed'), 'not-a-seed', {
      mode: 0o400,
    });
    await writeFile(join(root, 'locked.seed'), 'x', { mode: 0o600 });
    await chmod(join(root, 'locked.seed'), 0o000);
    vi.stubEnv('MOLTNET_SECRET_ROOT', root);
    const resolve = (ref: string) =>
      resolveExecutorSigningPrivateKey({
        authMode: 'agent-key',
        agentDir: '/nonexistent/agent',
        configuredPrivateKey: '',
        configuredPrivateKeyRef: ref,
      });

    await expect(resolve('file:identity.fp.seed')).rejects.toThrow(/32-byte/);
    await expect(resolve('file:locked.seed')).rejects.toThrow(
      /could not resolve MOLTNET_PRIVATE_KEY_REF/,
    );
    await expect(resolve('file:missing.seed')).rejects.toThrow(
      /could not resolve MOLTNET_PRIVATE_KEY_REF/,
    );
  });
});
