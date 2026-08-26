import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { assertSecretGuardCapabilityMock } = vi.hoisted(() => ({
  assertSecretGuardCapabilityMock: vi.fn(),
}));

vi.mock('../secret-guard-capability.js', () => ({
  assertSecretGuardCapability: assertSecretGuardCapabilityMock,
}));

import {
  GITHUB_GUARD_HOOK_COMMAND,
  SECRET_GUARD_HOOK_COMMAND,
} from '../setup.js';
import { CodexAdapter } from './codex.js';
import type { AgentAdapterOptions } from './types.js';

const tmpRepo = join(
  tmpdir(),
  'codex-adapter-test-' + Math.random().toString(36).slice(2),
);

const baseOpts: AgentAdapterOptions = {
  repoDir: tmpRepo,
  agentName: 'my-agent',
  prefix: 'MY_AGENT',
  mcpUrl: 'https://mcp.themolt.net/mcp',
  clientId: 'cid',
  appSlug: 'my-app',
  appId: '2878569',
  pemPath: '/tmp/my-app.pem',
  installationId: '99999',
};

beforeEach(async () => {
  assertSecretGuardCapabilityMock.mockReset().mockResolvedValue(undefined);
  await mkdir(tmpRepo, { recursive: true });
});

afterEach(async () => {
  await rm(tmpRepo, { recursive: true, force: true });
});

describe('CodexAdapter.writeMcpConfig', () => {
  it('creates .codex/config.toml with mcp_servers section', async () => {
    const adapter = new CodexAdapter();
    await adapter.writeMcpConfig(baseOpts);

    const raw = await readFile(join(tmpRepo, '.codex', 'config.toml'), 'utf-8');
    expect(raw).toContain('[mcp_servers.my-agent]');
    expect(raw).toContain('url = "https://mcp.themolt.net/mcp"');
    expect(raw).toContain('MY_AGENT_CLIENT_ID');
    expect(raw).toContain('MY_AGENT_CLIENT_SECRET');
  });

  it('merges into existing config.toml', async () => {
    const dir = join(tmpRepo, '.codex');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'config.toml'),
      '[mcp_servers.existing]\nurl = "https://example.com"\n',
      'utf-8',
    );

    const adapter = new CodexAdapter();
    await adapter.writeMcpConfig(baseOpts);

    const raw = await readFile(join(dir, 'config.toml'), 'utf-8');
    // Existing server preserved
    expect(raw).toContain('[mcp_servers.existing]');
    expect(raw).toContain('url = "https://example.com"');
    // New server added
    expect(raw).toContain('[mcp_servers.my-agent]');
    expect(raw).toContain('url = "https://mcp.themolt.net/mcp"');
  });
});

describe('CodexAdapter.writeRules', () => {
  it('writes .codex/rules/legreffier.rules with Starlark prefix_rule entries', async () => {
    const adapter = new CodexAdapter();
    await adapter.writeRules(baseOpts);

    const raw = await readFile(
      join(tmpRepo, '.codex', 'rules', 'legreffier.rules'),
      'utf-8',
    );
    expect(raw).toContain('prefix_rule(');
    expect(raw).toContain('pattern = ["git", "config"]');
    expect(raw).toContain('pattern = ["npx", "@themoltnet/cli", "sign"]');
    expect(raw).toContain('pattern = ["npx", "@themoltnet/cli", "sign"]');
    expect(raw).toContain(
      'pattern = ["npx", "@themoltnet/cli", "entry", "commit"]',
    );
    expect(raw).toContain(
      'pattern = ["npx", "@themoltnet/cli", "task", "list"]',
    );
    expect(raw).toContain(
      'pattern = ["npx", "@themoltnet/cli", "pack", "get"]',
    );
    expect(raw).toContain(
      'pattern = ["npx", "@themoltnet/cli", "rendered-pack", "get"]',
    );
    expect(raw).toContain(
      'pattern = ["npx", "@themoltnet/cli", "github", "token"]',
    );
    expect(raw).toContain('decision = "allow"');
  });
});

describe('CodexAdapter.writeSettings', () => {
  it('writes the GitHub guard to .codex/hooks.json', async () => {
    const adapter = new CodexAdapter();
    await adapter.writeSettings(baseOpts);
    expect(assertSecretGuardCapabilityMock).toHaveBeenCalledOnce();

    const parsed = JSON.parse(
      await readFile(join(tmpRepo, '.codex', 'hooks.json'), 'utf-8'),
    );
    expect(parsed.PreToolUse).toBeUndefined();
    expect(parsed.hooks.PreToolUse[0]).toEqual({
      matcher: 'Bash',
      hooks: [
        { type: 'command', command: SECRET_GUARD_HOOK_COMMAND },
        { type: 'command', command: GITHUB_GUARD_HOOK_COMMAND },
      ],
    });
    expect(
      parsed.hooks.PreToolUse.map(
        (entry: { matcher: string }) => entry.matcher,
      ),
    ).toEqual(['Bash', 'Read', 'Grep', 'Write', 'Edit', 'Glob', 'apply_patch']);
  });

  it('preserves existing hooks and does not duplicate the guard', async () => {
    const dir = join(tmpRepo, '.codex');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'hooks.json'),
      JSON.stringify({
        description: 'existing hooks',
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: 'bootstrap' }] },
          ],
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [
                { type: 'command', command: 'custom secret guard audit' },
                { type: 'command', command: 'moltnet secrets guard' },
                { type: 'command', command: 'moltnet github guard' },
              ],
            },
          ],
        },
      }),
      'utf-8',
    );

    const adapter = new CodexAdapter();
    await adapter.writeSettings(baseOpts);
    await adapter.writeSettings(baseOpts);

    const parsed = JSON.parse(await readFile(join(dir, 'hooks.json'), 'utf-8'));
    expect(parsed.description).toBe('existing hooks');
    expect(parsed.hooks.SessionStart).toHaveLength(1);
    expect(parsed.hooks.PreToolUse[0].hooks).toEqual([
      { type: 'command', command: SECRET_GUARD_HOOK_COMMAND },
      { type: 'command', command: 'custom secret guard audit' },
      { type: 'command', command: GITHUB_GUARD_HOOK_COMMAND },
    ]);
  });

  it('runs the secret guard only in an activated agent process', () => {
    for (const configured of [
      '',
      '/tmp/unrelated/gitconfig',
      '/tmp/.moltnet/team/my-agent/gitconfig',
    ]) {
      const inactive = spawnSync('/bin/sh', ['-c', SECRET_GUARD_HOOK_COMMAND], {
        encoding: 'utf-8',
        env: { GIT_CONFIG_GLOBAL: configured, PATH: '/usr/bin:/bin' },
        input: '{',
      });
      expect(inactive.status).toBe(0);
      expect(inactive.stdout).toBe('');
    }

    for (const configured of [
      '.moltnet/my-agent/gitconfig',
      String.raw`C:\repo\.moltnet\my-agent\gitconfig`,
    ]) {
      const active = spawnSync('/bin/sh', ['-c', SECRET_GUARD_HOOK_COMMAND], {
        encoding: 'utf-8',
        env: { GIT_CONFIG_GLOBAL: configured, PATH: '/usr/bin:/bin' },
        input: '{',
      });
      expect(active.status).toBe(0);
      expect(active.stdout).toContain('"permissionDecision":"deny"');
    }
  });

  it('does not write hooks when the released CLI lacks the guard', async () => {
    assertSecretGuardCapabilityMock.mockRejectedValueOnce(
      new Error('update moltnet'),
    );

    await expect(new CodexAdapter().writeSettings(baseOpts)).rejects.toThrow(
      'update moltnet',
    );
    await expect(
      readFile(join(tmpRepo, '.codex', 'hooks.json'), 'utf-8'),
    ).rejects.toThrow();
  });
});
