import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
  clientSecret: 'csec',
  appSlug: 'my-app',
  pemPath: '/tmp/my-app.pem',
  installationId: '99999',
};

beforeEach(async () => {
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
    expect(raw).toContain(
      'pattern = ["npx", "@themoltnet/cli", "github", "token"]',
    );
    expect(raw).toContain('decision = "allow"');
  });
});

describe('CodexAdapter.writeSettings', () => {
  it('is a no-op (env file generation moved to shared writeEnvFile)', async () => {
    const adapter = new CodexAdapter();
    // Should not throw and should not create any files
    await adapter.writeSettings(baseOpts);
  });
});
