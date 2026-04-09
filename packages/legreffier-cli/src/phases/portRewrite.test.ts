import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readConfig } from '@themoltnet/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runPortRewritePhase } from './portRewrite.js';

const tmpRoot = join(tmpdir(), 'legreffier-port-rewrite-' + Date.now());

async function seedTarget(sourceDir: string, targetDir: string) {
  // Simulate post-portCopy state: files are in target, moltnet.json
  // still has source absolute paths.
  await mkdir(join(targetDir, 'ssh'), { recursive: true });
  const config = {
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
      private_key_path: join(sourceDir, 'ssh', 'id_ed25519'),
      public_key_path: join(sourceDir, 'ssh', 'id_ed25519.pub'),
    },
    git: {
      name: 'legreffier',
      email: '1+legreffier[bot]@users.noreply.github.com',
      signing: true,
      config_path: join(sourceDir, 'gitconfig'),
    },
    github: {
      app_id: '2878569',
      app_slug: 'legreffier',
      installation_id: '99999',
      private_key_path: join(sourceDir, 'legreffier.pem'),
    },
  };
  await writeFile(
    join(targetDir, 'moltnet.json'),
    JSON.stringify(config),
    'utf-8',
  );
  await writeFile(join(targetDir, 'legreffier.pem'), 'PEM', { mode: 0o600 });
  await writeFile(join(targetDir, 'ssh', 'id_ed25519'), 'PRIV', {
    mode: 0o600,
  });
  await writeFile(join(targetDir, 'ssh', 'id_ed25519.pub'), 'PUB');
  return config;
}

beforeEach(async () => {
  await mkdir(tmpRoot, { recursive: true });
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('runPortRewritePhase', () => {
  it('rewrites absolute paths in moltnet.json and regenerates gitconfig + env', async () => {
    const source = join(tmpRoot, 'src');
    const target = join(tmpRoot, 'dst');
    const config = await seedTarget(source, target);

    const result = await runPortRewritePhase({
      targetDir: target,
      agentName: 'legreffier',
      config,
    });

    expect(result.rewrittenFields).toContain('ssh.private_key_path');
    expect(result.rewrittenFields).toContain('github.private_key_path');
    expect(result.rewrittenFields).toContain('git.config_path');

    const reread = await readConfig(target);
    expect(reread?.ssh?.private_key_path).toBe(
      join(target, 'ssh', 'id_ed25519'),
    );
    expect(reread?.ssh?.public_key_path).toBe(
      join(target, 'ssh', 'id_ed25519.pub'),
    );
    expect(reread?.github?.private_key_path).toBe(
      join(target, 'legreffier.pem'),
    );
    expect(reread?.github?.app_id).toBe('2878569');
    expect(reread?.github?.app_slug).toBe('legreffier');
    expect(reread?.git?.config_path).toBe(join(target, 'gitconfig'));

    // gitconfig regenerated — signingkey points at the new ssh PUBLIC key
    // path under [user] (where git actually reads it), not under [gpg "ssh"].
    const gitconfig = await readFile(join(target, 'gitconfig'), 'utf-8');
    expect(gitconfig).toMatch(
      new RegExp(
        `\\[user\\][\\s\\S]*signingkey = ${join(target, 'ssh', 'id_ed25519.pub').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      ),
    );
    expect(gitconfig).not.toMatch(/\[gpg "ssh"\][\s\S]*signingkey/i);
    expect(gitconfig).toContain('gpgsign = true');

    // env file has new PEM path and MOLTNET_AGENT_NAME
    const envContent = await readFile(join(target, 'env'), 'utf-8');
    expect(envContent).toContain(
      `LEGREFFIER_GITHUB_APP_PRIVATE_KEY_PATH='${join(target, 'legreffier.pem')}'`,
    );
    expect(envContent).toContain(`LEGREFFIER_GITHUB_APP_ID='2878569'`);
    expect(envContent).toContain(`MOLTNET_AGENT_NAME='legreffier'`);
  });
});
