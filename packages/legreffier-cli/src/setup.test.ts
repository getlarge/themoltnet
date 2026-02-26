import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadSkills, writeSettingsLocal } from './setup.js';

const tmpRepo = join(
  tmpdir(),
  'legreffier-test-' + Math.random().toString(36).slice(2),
);

beforeEach(async () => {
  await mkdir(tmpRepo, { recursive: true });
});

afterEach(async () => {
  await rm(tmpRepo, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('downloadSkills', () => {
  it('writes SKILL.md for each skill', async () => {
    vi.stubGlobal('fetch', async (url: string) => ({
      ok: true,
      text: async () => `# Skill content for ${url}`,
    }));

    await downloadSkills(tmpRepo);

    const legreffier = await readFile(
      join(tmpRepo, '.claude', 'skills', 'legreffier', 'SKILL.md'),
      'utf-8',
    );
    expect(legreffier).toContain('Skill content');
  });

  it('throws if fetch fails', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404 }));
    await expect(downloadSkills(tmpRepo)).rejects.toThrow(
      'Failed to download skill',
    );
  });
});

describe('writeSettingsLocal', () => {
  it('writes settings.local.json with correct structure', async () => {
    await writeSettingsLocal({
      repoDir: tmpRepo,
      agentName: 'my-agent',
      appSlug: 'my-app',
      pemPath: '/home/user/.config/moltnet/proj/my-app.pem',
      installationId: '99999',
      clientId: 'cid',
      clientSecret: 'csec',
    });

    const raw = await readFile(
      join(tmpRepo, '.claude', 'settings.local.json'),
      'utf-8',
    );
    const parsed = JSON.parse(raw);
    expect(parsed.env.MY_AGENT_GITHUB_APP_ID).toBe('my-app');
    expect(parsed.env.MY_AGENT_GITHUB_APP_PRIVATE_KEY_PATH).toBe(
      '/home/user/.config/moltnet/proj/my-app.pem',
    );
    expect(parsed.env.MY_AGENT_GITHUB_APP_INSTALLATION_ID).toBe('99999');
    expect(parsed.env.MY_AGENT_CLIENT_ID).toBe('cid');
    expect(parsed.env.MY_AGENT_CLIENT_SECRET).toBe('csec');
    expect(parsed.enableAllProjectMcpServers).toBe(true);
  });

  it('merges into existing settings.local.json', async () => {
    const filePath = join(tmpRepo, '.claude', 'settings.local.json');
    await mkdir(join(tmpRepo, '.claude'), { recursive: true });
    const existing = {
      env: { EXISTING_VAR: 'keep-me', OTHER_CLIENT_ID: 'other' },
      customKey: true,
    };
    const { writeFile } = await import('node:fs/promises');
    await writeFile(filePath, JSON.stringify(existing), 'utf-8');

    await writeSettingsLocal({
      repoDir: tmpRepo,
      agentName: 'my-agent',
      appSlug: 'my-app',
      pemPath: '/tmp/my-app.pem',
      installationId: '123',
      clientId: 'cid',
      clientSecret: 'csec',
    });

    const parsed = JSON.parse(await readFile(filePath, 'utf-8'));
    // Existing env vars preserved
    expect(parsed.env.EXISTING_VAR).toBe('keep-me');
    expect(parsed.env.OTHER_CLIENT_ID).toBe('other');
    // New agent vars added
    expect(parsed.env.MY_AGENT_CLIENT_ID).toBe('cid');
    expect(parsed.env.MY_AGENT_CLIENT_SECRET).toBe('csec');
    // Non-env keys preserved
    expect(parsed.customKey).toBe(true);
  });

  it('creates .claude dir if missing', async () => {
    await writeSettingsLocal({
      repoDir: tmpRepo,
      agentName: 'x',
      appSlug: 'x',
      pemPath: '/tmp/x.pem',
      installationId: '1',
      clientId: '',
      clientSecret: '',
    });
    const raw = await readFile(
      join(tmpRepo, '.claude', 'settings.local.json'),
      'utf-8',
    );
    expect(JSON.parse(raw)).toHaveProperty('env');
  });
});
