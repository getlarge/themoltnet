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

describe('CodexAdapter.writeSettings', () => {
  it('writes a sourceable env file with credentials', async () => {
    const adapter = new CodexAdapter();
    await adapter.writeSettings(baseOpts);

    const raw = await readFile(
      join(tmpRepo, '.moltnet', 'my-agent', 'env'),
      'utf-8',
    );
    expect(raw).toContain("MY_AGENT_CLIENT_ID='cid'");
    expect(raw).toContain("MY_AGENT_CLIENT_SECRET='csec'");
    expect(raw).toContain("MY_AGENT_GITHUB_APP_ID='my-app'");
    expect(raw).toContain("MY_AGENT_GITHUB_APP_INSTALLATION_ID='99999'");
  });
});
