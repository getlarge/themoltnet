import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { MoltNetConfig } from '../src/credentials.js';
import { repairConfig } from '../src/repair.js';

describe('repairConfig', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'moltnet-repair-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const validConfig: MoltNetConfig = {
    identity_id: 'test-agent',
    registered_at: '2026-01-01T00:00:00Z',
    oauth2: { client_id: 'cid', client_secret: 'csec' },
    keys: {
      public_key: 'ed25519:abc=',
      private_key: 'abc=',
      fingerprint: 'TEST',
    },
    endpoints: {
      api: 'https://api.themolt.net',
      mcp: 'https://mcp.themolt.net/mcp',
    },
  };

  async function writeConfig(
    dir: string,
    filename: string,
    config: MoltNetConfig,
  ): Promise<void> {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, filename), JSON.stringify(config));
  }

  it('reports no issues for a valid config', async () => {
    await writeConfig(tempDir, 'moltnet.json', validConfig);
    const result = await repairConfig({ configDir: tempDir });
    expect(result.issues).toHaveLength(0);
    expect(result.config).not.toBeNull();
  });

  it('reports missing required fields', async () => {
    const broken = {
      ...validConfig,
      identity_id: '',
      keys: { public_key: '', private_key: '', fingerprint: '' },
      endpoints: { api: '', mcp: '' },
    };
    await writeConfig(tempDir, 'moltnet.json', broken);
    const result = await repairConfig({ configDir: tempDir, dryRun: true });

    const fields = result.issues.map((i) => i.field);
    expect(fields).toContain('identity_id');
    expect(fields).toContain('keys.public_key');
    expect(fields).toContain('keys.private_key');
    expect(fields).toContain('endpoints.api');
  });

  it('warns about stale SSH paths', async () => {
    const config: MoltNetConfig = {
      ...validConfig,
      ssh: {
        private_key_path: '/nonexistent/id_ed25519',
        public_key_path: '/nonexistent/id_ed25519.pub',
      },
    };
    await writeConfig(tempDir, 'moltnet.json', config);
    const result = await repairConfig({ configDir: tempDir });

    const sshIssues = result.issues.filter((i) => i.field.startsWith('ssh.'));
    expect(sshIssues).toHaveLength(2);
    expect(sshIssues.every((i) => i.action === 'warning')).toBe(true);
  });

  it('detects legacy credentials.json and migrates', async () => {
    await writeConfig(tempDir, 'credentials.json', validConfig);
    const result = await repairConfig({ configDir: tempDir });

    expect(result.issues.some((i) => i.action === 'migrate')).toBe(true);

    // Verify moltnet.json was written
    const content = await readFile(join(tempDir, 'moltnet.json'), 'utf-8');
    const migrated = JSON.parse(content) as MoltNetConfig;
    expect(migrated.identity_id).toBe('test-agent');
  });

  it('does not write in dry-run mode', async () => {
    await writeConfig(tempDir, 'credentials.json', validConfig);
    await repairConfig({ configDir: tempDir, dryRun: true });

    // moltnet.json should NOT exist
    await expect(
      readFile(join(tempDir, 'moltnet.json'), 'utf-8'),
    ).rejects.toThrow();
  });

  it('returns null config when nothing found', async () => {
    const result = await repairConfig({ configDir: tempDir });
    expect(result.config).toBeNull();
    expect(result.issues).toHaveLength(0);
  });
});
