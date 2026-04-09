import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { MoltNetConfig } from '@themoltnet/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runPortCopyPhase } from './portCopy.js';

const tmpRoot = join(tmpdir(), 'legreffier-port-copy-' + Date.now());

async function seedSource(dir: string): Promise<MoltNetConfig> {
  await mkdir(join(dir, 'ssh'), { recursive: true });
  const config: MoltNetConfig = {
    identity_id: '11111111-1111-1111-1111-111111111111',
    registered_at: '2025-01-01T00:00:00.000Z',
    oauth2: { client_id: 'cid', client_secret: 'csec' },
    keys: {
      public_key: 'ed25519:abc',
      private_key: 'ed25519:priv',
      fingerprint: 'ed25519:fp',
    },
    endpoints: {
      api: 'https://api.themolt.net',
      mcp: 'https://mcp.themolt.net/mcp',
    },
    ssh: {
      private_key_path: join(dir, 'ssh', 'id_ed25519'),
      public_key_path: join(dir, 'ssh', 'id_ed25519.pub'),
    },
    git: {
      name: 'legreffier',
      email: '1+legreffier[bot]@users.noreply.github.com',
      signing: true,
      config_path: join(dir, 'gitconfig'),
    },
    github: {
      app_id: '2878569',
      app_slug: 'legreffier',
      installation_id: '99999',
      private_key_path: join(dir, 'legreffier.pem'),
    },
  };
  await writeFile(join(dir, 'moltnet.json'), JSON.stringify(config), 'utf-8');
  await writeFile(join(dir, 'legreffier.pem'), 'PEM', { mode: 0o600 });
  await writeFile(join(dir, 'ssh', 'id_ed25519'), 'PRIV', { mode: 0o600 });
  await writeFile(join(dir, 'ssh', 'id_ed25519.pub'), 'PUB');
  await writeFile(join(dir, 'gitconfig'), '[user]\n\tname = x\n');
  return config;
}

beforeEach(async () => {
  await mkdir(tmpRoot, { recursive: true });
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('runPortCopyPhase', () => {
  it('copies moltnet.json, pem, and ssh keys with correct permissions', async () => {
    const source = join(tmpRoot, 'src');
    const target = join(tmpRoot, 'dst');
    const config = await seedSource(source);

    const result = await runPortCopyPhase({
      sourceDir: source,
      targetDir: target,
      config,
    });

    expect(result.copied).toHaveLength(4); // json, pem, ssh priv, ssh pub
    expect(result.warnings).toHaveLength(1); // allowed_signers missing

    // Verify contents copied
    const copiedPem = await readFile(join(target, 'legreffier.pem'), 'utf-8');
    expect(copiedPem).toBe('PEM');
    const copiedPriv = await readFile(
      join(target, 'ssh', 'id_ed25519'),
      'utf-8',
    );
    expect(copiedPriv).toBe('PRIV');

    // Verify 0600 on private material
    const pemStat = await stat(join(target, 'legreffier.pem'));
    expect(pemStat.mode & 0o777).toBe(0o600);
    const privStat = await stat(join(target, 'ssh', 'id_ed25519'));
    expect(privStat.mode & 0o777).toBe(0o600);
    const pubStat = await stat(join(target, 'ssh', 'id_ed25519.pub'));
    expect(pubStat.mode & 0o777).toBe(0o644);
  });

  it('copies allowed_signers when present', async () => {
    const source = join(tmpRoot, 'src2');
    const target = join(tmpRoot, 'dst2');
    const config = await seedSource(source);
    await writeFile(
      join(source, 'ssh', 'allowed_signers'),
      'legreffier ssh-ed25519 AAAA\n',
    );

    const result = await runPortCopyPhase({
      sourceDir: source,
      targetDir: target,
      config,
    });

    expect(result.copied).toHaveLength(5);
    expect(result.warnings).toHaveLength(0);
    const allowed = await readFile(
      join(target, 'ssh', 'allowed_signers'),
      'utf-8',
    );
    expect(allowed).toContain('legreffier ssh-ed25519');
  });
});
