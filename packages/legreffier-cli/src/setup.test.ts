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
