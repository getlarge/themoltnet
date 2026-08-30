import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseEnvFile, writeEnvFile } from './env-file.js';
import {
  buildCodexRules,
  buildGhTokenRule,
  buildPermissions,
  CLAUDE_GITHUB_GUARD_HOOK_SCRIPT,
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
    expect(perms).toContain('Bash(moltnet entry commit *)');
    expect(perms).toContain('Bash(moltnet entry create-signed *)');
    expect(perms).toContain('Bash(moltnet entry verify *)');
    expect(perms).toContain('Bash(moltnet github token *)');
    expect(perms).toContain('Bash(moltnet agents activation *)');
    expect(perms).toContain('Bash(moltnet task list *)');
    expect(perms).toContain('Bash(moltnet task get *)');
    expect(perms).toContain('Bash(moltnet task attempts *)');
    expect(perms).toContain('Bash(moltnet task tail *)');
    expect(perms).toContain('Bash(moltnet pack list *)');
    expect(perms).toContain('Bash(moltnet pack get *)');
    expect(perms).toContain('Bash(moltnet rendered-pack list *)');
    expect(perms).toContain('Bash(moltnet rendered-pack get *)');
  });

  it('includes diary/entry/relations memory read commands (issue #1877)', () => {
    const perms = buildPermissions('x');
    expect(perms).toContain('Bash(moltnet diary list *)');
    expect(perms).toContain('Bash(moltnet diary get *)');
    expect(perms).toContain('Bash(moltnet diary tags *)');
    expect(perms).toContain('Bash(moltnet entry list *)');
    expect(perms).toContain('Bash(moltnet entry get *)');
    expect(perms).toContain('Bash(moltnet entry search *)');
    expect(perms).toContain('Bash(moltnet relations list *)');
  });

  it('includes npx equivalents for memory reads (issue #1877)', () => {
    const perms = buildPermissions('x');
    expect(perms).toContain('Bash(npx @themoltnet/cli diary list *)');
    expect(perms).toContain('Bash(npx @themoltnet/cli entry search *)');
    expect(perms).toContain('Bash(npx @themoltnet/cli relations list *)');
  });

  it('does NOT include the broad npx catch-all (issue #1877)', () => {
    const perms = buildPermissions('x');
    expect(perms).not.toContain('Bash(npx @themoltnet/cli *)');
  });

  it('does NOT allow mutation commands through the allowlist (issue #1877)', () => {
    const perms = buildPermissions('x');
    expect(perms).not.toContain('Bash(moltnet entry create *)');
    expect(perms).not.toContain('Bash(moltnet entry update *)');
    expect(perms).not.toContain('Bash(moltnet entry delete *)');
    expect(perms).not.toContain('Bash(moltnet diary create *)');
    expect(perms).not.toContain('Bash(moltnet relations create *)');
    expect(perms).not.toContain('Bash(moltnet relations update *)');
    expect(perms).not.toContain('Bash(moltnet relations delete *)');
    expect(perms).not.toContain('Bash(npx @themoltnet/cli entry create *)');
    expect(perms).not.toContain('Bash(npx @themoltnet/cli entry delete *)');
  });

  it('includes other standard entries', () => {
    const perms = buildPermissions('x');
    expect(perms).toContain('Bash(npx @themoltnet/cli sign *)');
    expect(perms).toContain('Bash(npx @themoltnet/cli entry commit *)');
    expect(perms).toContain('Bash(npx @themoltnet/cli entry create-signed *)');
    expect(perms).toContain('Bash(npx @themoltnet/cli entry verify *)');
    expect(perms).toContain('Bash(npx @themoltnet/cli github token *)');
    expect(perms).toContain('Bash(npx @themoltnet/cli agents activation *)');
    expect(perms).toContain('Bash(npx @themoltnet/cli task list *)');
    expect(perms).toContain('Bash(npx @themoltnet/cli task get *)');
    expect(perms).toContain('Bash(npx @themoltnet/cli task attempts *)');
    expect(perms).toContain('Bash(npx @themoltnet/cli task tail *)');
    expect(perms).toContain('Bash(npx @themoltnet/cli pack list *)');
    expect(perms).toContain('Bash(npx @themoltnet/cli pack get *)');
    expect(perms).toContain('Bash(npx @themoltnet/cli rendered-pack list *)');
    expect(perms).toContain('Bash(npx @themoltnet/cli rendered-pack get *)');
    expect(perms).toContain('Bash(ln -s *)');
    expect(perms).toContain('Bash(echo "GIT_CONFIG_GLOBAL=*")');
  });
});

describe('buildGhTokenRule', () => {
  it('documents the centralized guard and canonical scoped token form', () => {
    const rule = buildGhTokenRule();
    expect(rule).toContain('moltnet github guard');
    expect(rule).toContain('git rev-parse --show-toplevel');
    expect(rule).toContain('CREDS="$(dirname "$CFG")/moltnet.json"');
    expect(rule).toMatch(/GH_TOKEN=\$\(moltnet github token/);
    expect(rule).toMatch(/GH_TOKEN=\$\(npx @themoltnet\/cli github token/);
  });

  it('documents capability-aware fallback and safe uncertainty behavior', () => {
    const rule = buildGhTokenRule();
    expect(rule).toContain('user token as a fallback');
    expect(rule).toContain('lacks the required permission');
    expect(rule).toContain('human` authorship mode');
    expect(rule).toContain('unknown commands');
    expect(rule).toContain('GraphQL mutations require a scoped token');
    expect(rule).toContain('fails open silently');
    expect(rule).toContain('MOLTNET_GITHUB_GUARD_STRICT=1');
    expect(rule).toContain('MOLTNET_GITHUB_GUARD=off');
    expect(rule).toContain('gh-token-cache.json');
  });

  it('keeps command-scoped tokens isolated', () => {
    const rule = buildGhTokenRule();
    expect(rule).toContain('STRICT RULE');
    expect(rule).toContain('authorizes only that `gh` process');
    expect(rule).toContain('different `gh` command later in a chain');
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

describe('Claude GitHub guard hook', () => {
  it('stays in sync with the committed hook script', async () => {
    const committed = await readFile(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        '..',
        '.claude',
        'hooks',
        'moltnet-github-guard.sh',
      ),
      'utf-8',
    );
    expect(committed).toBe(CLAUDE_GITHUB_GUARD_HOOK_SCRIPT);
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
    // Signing & entry workflow
    expect(rules).toContain('pattern = ["moltnet", "sign"]');
    expect(rules).toContain('pattern = ["npx", "@themoltnet/cli", "sign"]');
    expect(rules).toContain('pattern = ["moltnet", "entry", "commit"]');
    expect(rules).toContain(
      'pattern = ["npx", "@themoltnet/cli", "entry", "commit"]',
    );
    expect(rules).toContain('pattern = ["moltnet", "entry", "create-signed"]');
    expect(rules).toContain(
      'pattern = ["npx", "@themoltnet/cli", "entry", "create-signed"]',
    );
    expect(rules).toContain('pattern = ["moltnet", "entry", "verify"]');
    expect(rules).toContain(
      'pattern = ["npx", "@themoltnet/cli", "entry", "verify"]',
    );
    expect(rules).toContain('pattern = ["moltnet", "github", "token"]');
    expect(rules).toContain(
      'pattern = ["npx", "@themoltnet/cli", "github", "token"]',
    );
    expect(rules).toContain('pattern = ["moltnet", "agents", "activation"]');
    // Task reads
    expect(rules).toContain('pattern = ["moltnet", "task", "list"]');
    expect(rules).toContain('pattern = ["moltnet", "task", "get"]');
    expect(rules).toContain('pattern = ["moltnet", "task", "attempts"]');
    expect(rules).toContain('pattern = ["moltnet", "task", "tail"]');
    expect(rules).toContain('pattern = ["moltnet", "pack", "list"]');
    expect(rules).toContain('pattern = ["moltnet", "pack", "get"]');
    expect(rules).toContain('pattern = ["moltnet", "rendered-pack", "list"]');
    expect(rules).toContain('pattern = ["moltnet", "rendered-pack", "get"]');
    expect(rules).toContain(
      'pattern = ["npx", "@themoltnet/cli", "task", "list"]',
    );
    expect(rules).toContain(
      'pattern = ["npx", "@themoltnet/cli", "task", "get"]',
    );
    expect(rules).toContain(
      'pattern = ["npx", "@themoltnet/cli", "task", "attempts"]',
    );
    expect(rules).toContain(
      'pattern = ["npx", "@themoltnet/cli", "task", "tail"]',
    );
    expect(rules).toContain(
      'pattern = ["npx", "@themoltnet/cli", "pack", "list"]',
    );
    expect(rules).toContain(
      'pattern = ["npx", "@themoltnet/cli", "pack", "get"]',
    );
    expect(rules).toContain(
      'pattern = ["npx", "@themoltnet/cli", "rendered-pack", "list"]',
    );
    expect(rules).toContain(
      'pattern = ["npx", "@themoltnet/cli", "rendered-pack", "get"]',
    );
    // gh CLI — read-only subcommands only (write ops prompt the user)
    expect(rules).toContain('pattern = ["gh", "pr", "view"]');
    expect(rules).toContain('pattern = ["gh", "pr", "list"]');
    expect(rules).toContain('pattern = ["gh", "issue", "view"]');
    expect(rules).toContain('pattern = ["gh", "issue", "list"]');
    expect(rules).toContain('pattern = ["gh", "repo", "view"]');
    expect(rules).toContain('pattern = ["ln", "-s"]');
    expect(rules).toContain('decision = "allow"');
    expect(rules).not.toContain('pattern = ["gh", "pr"]');
    expect(rules).not.toContain('pattern = ["gh", "issue"]');
  });

  it('includes diary/entry/relations memory read rules (issue #1877)', () => {
    const rules = buildCodexRules('legreffier');
    // Native moltnet form
    expect(rules).toContain('pattern = ["moltnet", "diary", "list"]');
    expect(rules).toContain('pattern = ["moltnet", "diary", "get"]');
    expect(rules).toContain('pattern = ["moltnet", "diary", "tags"]');
    expect(rules).toContain('pattern = ["moltnet", "entry", "list"]');
    expect(rules).toContain('pattern = ["moltnet", "entry", "get"]');
    expect(rules).toContain('pattern = ["moltnet", "entry", "search"]');
    expect(rules).toContain('pattern = ["moltnet", "relations", "list"]');
    // npx form
    expect(rules).toContain(
      'pattern = ["npx", "@themoltnet/cli", "diary", "list"]',
    );
    expect(rules).toContain(
      'pattern = ["npx", "@themoltnet/cli", "diary", "get"]',
    );
    expect(rules).toContain(
      'pattern = ["npx", "@themoltnet/cli", "diary", "tags"]',
    );
    expect(rules).toContain(
      'pattern = ["npx", "@themoltnet/cli", "entry", "list"]',
    );
    expect(rules).toContain(
      'pattern = ["npx", "@themoltnet/cli", "entry", "get"]',
    );
    expect(rules).toContain(
      'pattern = ["npx", "@themoltnet/cli", "entry", "search"]',
    );
    expect(rules).toContain(
      'pattern = ["npx", "@themoltnet/cli", "relations", "list"]',
    );
  });

  it('does NOT include the broad npx catch-all (issue #1877)', () => {
    const rules = buildCodexRules('legreffier');
    expect(rules).not.toContain('pattern = ["npx", "@themoltnet/cli"]');
  });

  it('does NOT allow mutation commands through the rules (issue #1877)', () => {
    const rules = buildCodexRules('legreffier');
    expect(rules).not.toContain('pattern = ["moltnet", "entry", "create"]');
    expect(rules).not.toContain('pattern = ["moltnet", "entry", "update"]');
    expect(rules).not.toContain('pattern = ["moltnet", "entry", "delete"]');
    expect(rules).not.toContain('pattern = ["moltnet", "diary", "create"]');
    expect(rules).not.toContain('pattern = ["moltnet", "relations", "create"]');
    expect(rules).not.toContain('pattern = ["moltnet", "relations", "update"]');
    expect(rules).not.toContain('pattern = ["moltnet", "relations", "delete"]');
    expect(rules).not.toContain(
      'pattern = ["npx", "@themoltnet/cli", "entry", "create"]',
    );
    expect(rules).not.toContain(
      'pattern = ["npx", "@themoltnet/cli", "entry", "delete"]',
    );
  });

  it('states that Codex must restart after rules change (issue #1877)', () => {
    const rules = buildCodexRules('legreffier');
    expect(rules).toContain('restart the Codex trusted project session');
  });

  it('does not contain markdown', () => {
    const rules = buildCodexRules('legreffier');
    expect(rules).not.toContain('```');
    expect(rules).not.toContain('## ');
  });

  it('stays in sync with the committed .codex/rules/legreffier.rules', async () => {
    // The committed file in this repo is read by Codex agents running here;
    // the generator output is what `legreffier port` writes into other repos.
    // They must never drift — regenerate with:
    //   node --experimental-strip-types -e \
    //     "import('./src/setup.ts').then(m => process.stdout.write(m.buildCodexRules('legreffier')))" \
    //     > ../../.codex/rules/legreffier.rules
    const committed = await readFile(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        '..',
        '.codex',
        'rules',
        'legreffier.rules',
      ),
      'utf-8',
    );
    expect(committed).toBe(buildCodexRules('legreffier'));
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
    expect(parsed.env).not.toHaveProperty('MY_AGENT_CLIENT_SECRET');
    expect(parsed.env.GIT_CONFIG_GLOBAL).toBe('.moltnet/my-agent/gitconfig');
    expect(parsed.enabledMcpjsonServers).toEqual(['my-agent']);
    // Permissions include agent-specific MCP wildcard
    expect(parsed.permissions.allow).toContain('mcp__my-agent__*');
    expect(parsed.permissions.allow).toContain('Bash(git config *)');
    expect(parsed.permissions.allow).toContain('Bash(moltnet sign *)');
    expect(parsed.permissions.allow).toContain('Bash(moltnet entry commit *)');
    expect(parsed.permissions.allow).toContain(
      'Bash(moltnet entry create-signed *)',
    );
    expect(parsed.permissions.allow).toContain('Bash(moltnet entry verify *)');
    expect(parsed.permissions.allow).toContain('Bash(moltnet task list *)');
    expect(parsed.permissions.allow).toContain('Bash(moltnet task get *)');
    expect(parsed.permissions.allow).toContain('Bash(moltnet task attempts *)');
    expect(parsed.permissions.allow).toContain('Bash(moltnet task tail *)');
    expect(parsed.permissions.allow).toContain('Bash(moltnet pack list *)');
    expect(parsed.permissions.allow).toContain('Bash(moltnet pack get *)');
    expect(parsed.permissions.allow).toContain(
      'Bash(moltnet rendered-pack list *)',
    );
    expect(parsed.permissions.allow).toContain(
      'Bash(moltnet rendered-pack get *)',
    );
    expect(parsed.permissions.allow).toContain(
      'Bash(npx @themoltnet/cli entry commit *)',
    );
    expect(parsed.permissions.allow).toContain(
      'Bash(npx @themoltnet/cli entry create-signed *)',
    );
    expect(parsed.permissions.allow).toContain(
      'Bash(npx @themoltnet/cli entry verify *)',
    );
    expect(parsed.permissions.allow).toContain(
      'Bash(npx @themoltnet/cli task list *)',
    );
    expect(parsed.permissions.allow).toContain(
      'Bash(npx @themoltnet/cli task get *)',
    );
    expect(parsed.permissions.allow).toContain(
      'Bash(npx @themoltnet/cli task attempts *)',
    );
    expect(parsed.permissions.allow).toContain(
      'Bash(npx @themoltnet/cli task tail *)',
    );
    expect(parsed.permissions.allow).toContain(
      'Bash(npx @themoltnet/cli pack list *)',
    );
    expect(parsed.permissions.allow).toContain(
      'Bash(npx @themoltnet/cli pack get *)',
    );
    expect(parsed.permissions.allow).toContain(
      'Bash(npx @themoltnet/cli rendered-pack list *)',
    );
    expect(parsed.permissions.allow).toContain(
      'Bash(npx @themoltnet/cli rendered-pack get *)',
    );
    expect(parsed.hooks).toBeUndefined();
  });

  it('merges into existing settings.local.json', async () => {
    const filePath = join(tmpRepo, '.claude', 'settings.local.json');
    await mkdir(join(tmpRepo, '.claude'), { recursive: true });
    const existing = {
      env: {
        EXISTING_VAR: 'keep-me',
        OTHER_CLIENT_ID: 'other',
        MY_AGENT_CLIENT_SECRET: 'legacy-plaintext-secret',
      },
      enabledMcpjsonServers: ['other-agent'],
      permissions: { allow: ['Bash(custom-cmd *)', 'Bash(git config *)'] },
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'bootstrap' }] }],
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'custom-guard' }],
          },
        ],
      },
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
    expect(parsed.env).not.toHaveProperty('MY_AGENT_CLIENT_SECRET');
    expect(parsed.env.GIT_CONFIG_GLOBAL).toBe('.moltnet/my-agent/gitconfig');
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
    expect(parsed.hooks.SessionStart).toHaveLength(1);
    expect(parsed.hooks.PreToolUse[0].hooks).toEqual([
      { type: 'command', command: 'custom-guard' },
    ]);
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
      fingerprint: 'SHA256:testfingerprint',
    });

    const content = await readFile(join(envDir, 'env'), 'utf-8');
    expect(content).toContain("MY_AGENT_CLIENT_ID='cid'");
    expect(content).not.toContain('MY_AGENT_CLIENT_SECRET');
    expect(content).not.toContain('csec');
    expect(content).toContain("MY_AGENT_GITHUB_APP_ID='2878569'");
    expect(content).toContain(
      "MY_AGENT_GITHUB_APP_PRIVATE_KEY_PATH='/tmp/my-app.pem'",
    );
    expect(content).toContain("MY_AGENT_GITHUB_APP_INSTALLATION_ID='12345'");
    expect(content).toContain(
      "GIT_CONFIG_GLOBAL='.moltnet/my-agent/gitconfig'",
    );
    expect(content).toContain("MOLTNET_AGENT_NAME='my-agent'");
    expect(content).toContain("MOLTNET_FINGERPRINT='SHA256:testfingerprint'");
  });

  it('writes repo-relative pem path when the pem lives in the agent dir', async () => {
    const envDir = join(tmpRepo, '.moltnet', 'my-agent');

    await writeEnvFile({
      envDir,
      agentName: 'my-agent',
      prefix: 'MY_AGENT',
      clientId: 'cid',
      clientSecret: 'csec',
      appId: '2878569',
      pemPath: join(envDir, 'my-app.pem'),
      installationId: '12345',
    });

    const content = await readFile(join(envDir, 'env'), 'utf-8');
    expect(content).toContain(
      "MY_AGENT_GITHUB_APP_PRIVATE_KEY_PATH='.moltnet/my-agent/my-app.pem'",
    );
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
    expect(content).not.toContain('MY_AGENT_CLIENT_SECRET');
    expect(content).not.toContain('csec-v2');
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
