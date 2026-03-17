import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildCodexRules,
  buildGhTokenRule,
  buildPermissions,
  downloadSkills,
  writeSettingsLocal,
} from './setup.js';

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
  it('writes SKILL.md to the given skill directory', async () => {
    vi.stubGlobal('fetch', async (url: string) => ({
      ok: true,
      text: async () => `# Skill content for ${url}`,
    }));

    await downloadSkills(tmpRepo, '.claude/skills');

    const content = await readFile(
      join(tmpRepo, '.claude', 'skills', 'legreffier', 'SKILL.md'),
      'utf-8',
    );
    expect(content).toContain('Skill content');
  });

  it('writes SKILL.md to codex skill directory', async () => {
    vi.stubGlobal('fetch', async (url: string) => ({
      ok: true,
      text: async () => `# Skill content for ${url}`,
    }));

    await downloadSkills(tmpRepo, '.agents/skills');

    const content = await readFile(
      join(tmpRepo, '.agents', 'skills', 'legreffier', 'SKILL.md'),
      'utf-8',
    );
    expect(content).toContain('Skill content');
  });

  it('warns and skips if fetch returns non-200', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404 }));
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    await downloadSkills(tmpRepo, '.claude/skills');

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('could not download skill'),
    );
    const { stat } = await import('node:fs/promises');
    await expect(
      stat(join(tmpRepo, '.claude', 'skills', 'legreffier', 'SKILL.md')),
    ).rejects.toThrow();
  });
});

describe('buildPermissions', () => {
  it('includes agent-specific MCP wildcard', () => {
    const perms = buildPermissions('my-agent');
    expect(perms).toContain('mcp__my-agent__*');
  });

  it('includes read-only git and signing commands', () => {
    const perms = buildPermissions('x');
    expect(perms).toContain('Bash(git config *)');
    expect(perms).toContain('Bash(git diff *)');
    expect(perms).toContain('Bash(git log *)');
    expect(perms).toContain('Bash(git rev-parse *)');
    expect(perms).toContain('Bash(moltnet sign *)');
    expect(perms).toContain('Bash(moltnet github token *)');
    expect(perms).toContain('Bash(npx @themoltnet/cli sign *)');
    expect(perms).toContain('Bash(npx @themoltnet/cli github token *)');
    expect(perms).toContain('Bash(ln -s *)');
    expect(perms).toContain('Bash(echo "GIT_CONFIG_GLOBAL=*")');
  });
});

describe('buildGhTokenRule', () => {
  it('produces rule using dynamic credentials path from GIT_CONFIG_GLOBAL', () => {
    const rule = buildGhTokenRule('legreffier');
    expect(rule).toContain('$(dirname "$GIT_CONFIG_GLOBAL")/moltnet.json');
    expect(rule).toContain('GH_TOKEN');
    expect(rule).toContain('npx @themoltnet/cli github token');
    expect(rule).toContain('.moltnet/legreffier/gitconfig');
  });

  it('lists scoped gh subcommands matching app permissions', () => {
    const rule = buildGhTokenRule('legreffier');
    expect(rule).toContain('gh pr');
    expect(rule).toContain('gh issue');
    expect(rule).toContain('gh api repos/{owner}/{repo}/contents/');
    expect(rule).toContain('gh repo view');
  });

  it('mentions token caching and 401 recovery', () => {
    const rule = buildGhTokenRule('legreffier');
    expect(rule).toContain('cached locally');
    expect(rule).toContain('gh-token-cache.json');
    expect(rule).toContain('401');
  });
});

describe('buildCodexRules', () => {
  it('produces Starlark prefix_rule entries for allowed commands', () => {
    const rules = buildCodexRules('legreffier');
    expect(rules).toContain('prefix_rule(');
    expect(rules).toContain('pattern = ["git", "config"]');
    expect(rules).toContain('pattern = ["git", "diff"]');
    expect(rules).toContain('pattern = ["git", "log"]');
    expect(rules).toContain('pattern = ["git", "rev-parse"]');
    expect(rules).toContain('pattern = ["npx", "@themoltnet/cli", "sign"]');
    expect(rules).toContain(
      'pattern = ["npx", "@themoltnet/cli", "diary", "commit"]',
    );
    expect(rules).toContain(
      'pattern = ["npx", "@themoltnet/cli", "diary", "create-signed"]',
    );
    expect(rules).toContain(
      'pattern = ["npx", "@themoltnet/cli", "diary", "verify"]',
    );
    expect(rules).toContain('pattern = ["moltnet", "diary", "commit"]');
    expect(rules).toContain('pattern = ["moltnet", "diary", "create-signed"]');
    expect(rules).toContain('pattern = ["moltnet", "diary", "verify"]');
    expect(rules).toContain(
      'pattern = ["npx", "@themoltnet/cli", "github", "token"]',
    );
    expect(rules).toContain('pattern = ["ln", "-s"]');
    expect(rules).toContain('decision = "allow"');
  });

  it('does not contain markdown', () => {
    const rules = buildCodexRules('legreffier');
    expect(rules).not.toContain('```');
    expect(rules).not.toContain('## ');
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
    expect(parsed.enabledMcpjsonServers).toEqual(['my-agent']);
    // Permissions include agent-specific MCP wildcard
    expect(parsed.permissions.allow).toContain('mcp__my-agent__*');
    expect(parsed.permissions.allow).toContain('Bash(git config *)');
    expect(parsed.permissions.allow).toContain('Bash(moltnet sign *)');
    expect(parsed.permissions.allow).toContain('Bash(moltnet diary commit *)');
    expect(parsed.permissions.allow).toContain(
      'Bash(moltnet diary create-signed *)',
    );
    expect(parsed.permissions.allow).toContain('Bash(moltnet diary verify *)');
    expect(parsed.permissions.allow).toContain(
      'Bash(npx @themoltnet/cli diary commit *)',
    );
    expect(parsed.permissions.allow).toContain(
      'Bash(npx @themoltnet/cli diary create-signed *)',
    );
    expect(parsed.permissions.allow).toContain(
      'Bash(npx @themoltnet/cli diary verify *)',
    );
  });

  it('merges into existing settings.local.json', async () => {
    const filePath = join(tmpRepo, '.claude', 'settings.local.json');
    await mkdir(join(tmpRepo, '.claude'), { recursive: true });
    const existing = {
      env: { EXISTING_VAR: 'keep-me', OTHER_CLIENT_ID: 'other' },
      enabledMcpjsonServers: ['other-agent'],
      permissions: { allow: ['Bash(custom-cmd *)', 'Bash(git config *)'] },
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
    // Agent added to enabledMcpjsonServers without duplicating existing
    expect(parsed.enabledMcpjsonServers).toEqual(['other-agent', 'my-agent']);
    // Existing permissions preserved, new ones appended, no duplicates
    expect(parsed.permissions.allow[0]).toBe('Bash(custom-cmd *)');
    expect(parsed.permissions.allow[1]).toBe('Bash(git config *)');
    expect(parsed.permissions.allow).toContain('mcp__my-agent__*');
    // 'Bash(git config *)' not duplicated
    expect(
      parsed.permissions.allow.filter(
        (p: string) => p === 'Bash(git config *)',
      ),
    ).toHaveLength(1);
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
