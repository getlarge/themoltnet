import {
  appendFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseEnvFile, writeEnvFile } from './env-file.js';
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

  it('downloads companion reference files next to the skill', async () => {
    vi.stubGlobal('fetch', async (url: string) => ({
      ok: true,
      text: async () =>
        url.endsWith('references/exploration-pack-plan.yaml')
          ? 'operator_controls: {}'
          : `# Skill content for ${url}`,
    }));

    await downloadSkills(tmpRepo, '.claude/skills');

    const template = await readFile(
      join(
        tmpRepo,
        '.claude',
        'skills',
        'legreffier-explore',
        'references',
        'exploration-pack-plan.yaml',
      ),
      'utf-8',
    );
    expect(template).toContain('operator_controls');
  });

  it('downloads all referenced scan docs with the skill bundle', async () => {
    vi.stubGlobal('fetch', async (url: string) => ({
      ok: true,
      text: async () => `content for ${url}`,
    }));

    await downloadSkills(tmpRepo, '.claude/skills');

    const scanFlows = await readFile(
      join(
        tmpRepo,
        '.claude',
        'skills',
        'legreffier-scan',
        'references',
        'scan-flows.md',
      ),
      'utf-8',
    );
    const pathDiscovery = await readFile(
      join(
        tmpRepo,
        '.claude',
        'skills',
        'legreffier-scan',
        'references',
        'path-discovery.md',
      ),
      'utf-8',
    );
    const contentTemplates = await readFile(
      join(
        tmpRepo,
        '.claude',
        'skills',
        'legreffier-scan',
        'references',
        'content-templates.md',
      ),
      'utf-8',
    );

    expect(scanFlows).toContain('scan-flows.md');
    expect(pathDiscovery).toContain('path-discovery.md');
    expect(contentTemplates).toContain('content-templates.md');
  });

  it('warns and skips if fetch returns non-200', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404 }));
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    await downloadSkills(tmpRepo, '.claude/skills');

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('could not download skill'),
    );
    await expect(
      stat(join(tmpRepo, '.claude', 'skills', 'legreffier', 'SKILL.md')),
    ).rejects.toThrow();
  });

  it('falls back to main only when a full skill payload is available', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (
        url.includes('legreffier-v0.1.0/.claude/skills/legreffier-explore/') &&
        url.endsWith('references/exploration-pack-plan.yaml')
      ) {
        return { ok: false, status: 404 };
      }

      return {
        ok: true,
        text: async () =>
          url.includes('/main/')
            ? `main payload for ${url}`
            : `tag payload for ${url}`,
      };
    });

    await downloadSkills(tmpRepo, '.claude/skills');

    const skill = await readFile(
      join(tmpRepo, '.claude', 'skills', 'legreffier-explore', 'SKILL.md'),
      'utf-8',
    );
    const template = await readFile(
      join(
        tmpRepo,
        '.claude',
        'skills',
        'legreffier-explore',
        'references',
        'exploration-pack-plan.yaml',
      ),
      'utf-8',
    );

    expect(skill).toContain('/main/');
    expect(template).toContain('/main/');
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
  it('produces rule using absolute credentials path resolved from GIT_CONFIG_GLOBAL', () => {
    const rule = buildGhTokenRule();
    expect(rule).toContain(
      '$(cd "$(dirname "$GIT_CONFIG_GLOBAL")" 2>/dev/null && pwd)/moltnet.json',
    );
    expect(rule).toContain('GH_TOKEN');
    expect(rule).toContain('moltnet github token');
    expect(rule).toContain('npx @themoltnet/cli github token');
    expect(rule).toContain('.moltnet/<agent>/gitconfig');
  });

  it('forbids referencing $MOLTNET_CLI (unset in ad-hoc shells causes silent fallback to human token)', () => {
    const rule = buildGhTokenRule();
    // The rule must not USE $MOLTNET_CLI in a command example, but it must
    // explicitly call out why referencing it is forbidden.
    expect(rule).toMatch(/GH_TOKEN=\$\(moltnet github token/);
    expect(rule).toMatch(/GH_TOKEN=\$\(npx @themoltnet\/cli github token/);
    expect(rule).toContain('$MOLTNET_CLI');
    expect(rule).toContain('ad-hoc shells');
  });

  it('is generic across MoltNet agents (not legreffier-specific)', () => {
    const rule = buildGhTokenRule();
    expect(rule).toContain('MoltNet agents');
    // Must describe the pattern, not hardcode the legreffier agent name
    expect(rule).toContain('.moltnet/<agent>/gitconfig');
  });

  it('lists scoped gh subcommands matching app permissions', () => {
    const rule = buildGhTokenRule();
    expect(rule).toContain('gh pr');
    expect(rule).toContain('gh issue');
    expect(rule).toContain('gh api repos/{owner}/{repo}/contents/');
    expect(rule).toContain('gh repo view');
  });

  it('mentions token caching and 401 recovery', () => {
    const rule = buildGhTokenRule();
    expect(rule).toContain('cached locally');
    expect(rule).toContain('gh-token-cache.json');
    expect(rule).toContain('401');
  });

  it('enforces absolute path resolution for credentials', () => {
    const rule = buildGhTokenRule();
    expect(rule).toContain('STRICT RULE');
    expect(rule).toContain('absolute path');
    expect(rule).toContain('CREDS=');
    expect(rule).toContain(
      '$(cd "$(dirname "$GIT_CONFIG_GLOBAL")" 2>/dev/null && pwd)',
    );
    expect(rule).toContain('Forbidden patterns');
    expect(rule).toContain('Why absolute paths are mandatory');
    // Behavioral centerpiece: hard failure on missing credentials file
    expect(rule).toContain('[ -f "$CREDS" ]');
  });

  it('stays in sync with the committed .claude/rules/legreffier-gh.md', async () => {
    // The committed file in this repo is read by agents running here; the
    // generator output is what `legreffier port` writes into other repos.
    // They must never drift — regenerate with:
    //   node -e "import('./src/setup.ts').then(m => process.stdout.write(m.buildGhTokenRule()))" \
    //     > ../../.claude/rules/legreffier-gh.md
    const committed = await readFile(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        '..',
        '.claude',
        'rules',
        'legreffier-gh.md',
      ),
      'utf-8',
    );
    expect(committed).toBe(buildGhTokenRule());
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
    // gh CLI — read-only subcommands only (write ops prompt the user)
    expect(rules).toContain('pattern = ["gh", "pr", "view"]');
    expect(rules).toContain('pattern = ["gh", "pr", "list"]');
    expect(rules).toContain('pattern = ["gh", "issue", "view"]');
    expect(rules).toContain('pattern = ["gh", "issue", "list"]');
    expect(rules).toContain('pattern = ["gh", "repo", "view"]');
    expect(rules).not.toContain('pattern = ["gh", "pr"]');
    expect(rules).not.toContain('pattern = ["gh", "issue"]');
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
      appId: '2878569',
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
    expect(parsed.env.MY_AGENT_GITHUB_APP_ID).toBe('2878569');
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
    await writeFile(filePath, JSON.stringify(existing), 'utf-8');

    await writeSettingsLocal({
      repoDir: tmpRepo,
      agentName: 'my-agent',
      appId: '2878569',
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
      appId: 'x',
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

describe('writeEnvFile', () => {
  it('generates env file with credentials and GIT_CONFIG_GLOBAL', async () => {
    const envDir = join(tmpRepo, '.moltnet', 'my-agent');

    await writeEnvFile({
      envDir,
      agentName: 'my-agent',
      prefix: 'MY_AGENT',
      clientId: 'cid',
      clientSecret: 'csec',
      appId: '2878569',
      pemPath: '/tmp/my-app.pem',
      installationId: '12345',
    });

    const content = await readFile(join(envDir, 'env'), 'utf-8');
    expect(content).toContain("MY_AGENT_CLIENT_ID='cid'");
    expect(content).toContain("MY_AGENT_CLIENT_SECRET='csec'");
    expect(content).toContain("MY_AGENT_GITHUB_APP_ID='2878569'");
    expect(content).toContain(
      "MY_AGENT_GITHUB_APP_PRIVATE_KEY_PATH='/tmp/my-app.pem'",
    );
    expect(content).toContain("MY_AGENT_GITHUB_APP_INSTALLATION_ID='12345'");
    expect(content).toContain(
      "GIT_CONFIG_GLOBAL='.moltnet/my-agent/gitconfig'",
    );
    expect(content).toContain("MOLTNET_AGENT_NAME='my-agent'");
  });

  it('preserves user-added vars on re-run', async () => {
    const envDir = join(tmpRepo, '.moltnet', 'my-agent');
    await mkdir(envDir, { recursive: true });

    // First run
    await writeEnvFile({
      envDir,
      agentName: 'my-agent',
      prefix: 'MY_AGENT',
      clientId: 'cid-v1',
      clientSecret: 'csec-v1',
      appId: '2878569',
      pemPath: '/tmp/my-app.pem',
      installationId: '12345',
    });

    // User adds custom vars
    await appendFile(
      join(envDir, 'env'),
      "\n# My diary\nMOLTNET_DIARY_ID='abc-123'\nCUSTOM_VAR='keep-me'\n",
    );

    // Second run (e.g. legreffier setup re-run with new secret)
    await writeEnvFile({
      envDir,
      agentName: 'my-agent',
      prefix: 'MY_AGENT',
      clientId: 'cid-v2',
      clientSecret: 'csec-v2',
      appId: '2878569',
      pemPath: '/tmp/my-app.pem',
      installationId: '12345',
    });

    const content = await readFile(join(envDir, 'env'), 'utf-8');
    // Updated managed vars
    expect(content).toContain("MY_AGENT_CLIENT_ID='cid-v2'");
    expect(content).toContain("MY_AGENT_CLIENT_SECRET='csec-v2'");
    // Preserved user vars
    expect(content).toContain("MOLTNET_DIARY_ID='abc-123'");
    expect(content).toContain("CUSTOM_VAR='keep-me'");
    // Preserved comments
    expect(content).toContain('# My diary');
    // No duplicate managed keys
    expect(content.match(/MY_AGENT_CLIENT_ID/g)?.length).toBe(1);
  });
});

describe('parseEnvFile', () => {
  it('parses key=value pairs with various quoting styles', () => {
    const content =
      'SIMPLE=value\nQUOTED=\'hello world\'\nDOUBLE="hi"\n# comment\n\nEMPTY=\n';
    const vars = parseEnvFile(content);
    expect(vars['SIMPLE']).toBe('value');
    expect(vars['QUOTED']).toBe('hello world');
    expect(vars['DOUBLE']).toBe('hi');
    expect(vars['EMPTY']).toBe('');
    expect('# comment' in vars).toBe(false);
  });
});
