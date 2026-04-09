import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runPortValidatePhase } from './portValidate.js';

const tmpRoot = join(tmpdir(), 'legreffier-port-validate-' + Date.now());

async function writeConfig(dir: string, config: unknown): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'moltnet.json'),
    JSON.stringify(config, null, 2),
    'utf-8',
  );
}

function baseConfig(dir: string): Record<string, unknown> {
  return {
    identity_id: '11111111-1111-1111-1111-111111111111',
    registered_at: '2025-01-01T00:00:00.000Z',
    oauth2: { client_id: 'cid', client_secret: 'csec' },
    keys: {
      public_key: 'ed25519:abcdef',
      private_key: 'ed25519:privatekey',
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
}

async function writeFiles(dir: string): Promise<void> {
  await mkdir(join(dir, 'ssh'), { recursive: true });
  await writeFile(join(dir, 'ssh', 'id_ed25519'), 'privkey', { mode: 0o600 });
  await writeFile(join(dir, 'ssh', 'id_ed25519.pub'), 'pubkey');
  await writeFile(join(dir, 'gitconfig'), '[user]\n\tname = x\n');
  await writeFile(join(dir, 'legreffier.pem'), 'PEM', { mode: 0o600 });
}

beforeEach(async () => {
  await mkdir(tmpRoot, { recursive: true });
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('runPortValidatePhase', () => {
  it('returns canProceed=true on a complete source dir', async () => {
    const dir = join(tmpRoot, 'ok');
    await writeConfig(dir, baseConfig(dir));
    await writeFiles(dir);

    const result = await runPortValidatePhase({ sourceDir: dir });

    expect(result.canProceed).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.config.github?.app_id).toBe('2878569');
  });

  it('throws when moltnet.json is missing', async () => {
    const dir = join(tmpRoot, 'empty');
    await mkdir(dir, { recursive: true });

    await expect(runPortValidatePhase({ sourceDir: dir })).rejects.toThrow(
      /No moltnet.json found/,
    );
  });

  it('flags non-numeric github.app_id (legacy slug-as-id)', async () => {
    const dir = join(tmpRoot, 'legacy');
    const config = baseConfig(dir);
    (config.github as Record<string, string>).app_id = 'legreffier';
    await writeConfig(dir, config);
    await writeFiles(dir);

    const result = await runPortValidatePhase({ sourceDir: dir });

    expect(result.canProceed).toBe(false);
    expect(result.issues.some((i) => i.field === 'github.app_id')).toBe(true);
  });

  it('flags missing ssh file on disk', async () => {
    const dir = join(tmpRoot, 'no-ssh');
    await writeConfig(dir, baseConfig(dir));
    // Intentionally skip writeFiles

    const result = await runPortValidatePhase({ sourceDir: dir });

    expect(result.canProceed).toBe(false);
    expect(result.issues.some((i) => i.field === 'ssh.private_key_path')).toBe(
      true,
    );
  });

  it('sets canProceed=true when only non-blocking (fixed/migrate) issues exist', async () => {
    const dir = join(tmpRoot, 'fixed-only');
    const config = baseConfig(dir);
    // Strip endpoints.mcp so repairConfig auto-fixes it with action=fixed
    delete (config.endpoints as Record<string, string>).mcp;
    await writeConfig(dir, config);
    await writeFiles(dir);

    const result = await runPortValidatePhase({ sourceDir: dir });

    // The fixed issue is reported but must not block the port
    expect(result.issues.some((i) => i.action === 'fixed')).toBe(true);
    expect(result.issues.some((i) => i.action === 'warning')).toBe(false);
    expect(result.canProceed).toBe(true);
  });

  it('flags missing required field github.installation_id', async () => {
    const dir = join(tmpRoot, 'no-install');
    const config = baseConfig(dir);
    delete (config.github as Record<string, string>).installation_id;
    await writeConfig(dir, config);
    await writeFiles(dir);

    const result = await runPortValidatePhase({ sourceDir: dir });

    expect(result.canProceed).toBe(false);
    expect(
      result.issues.some((i) => i.field === 'github.installation_id'),
    ).toBe(true);
  });
});
