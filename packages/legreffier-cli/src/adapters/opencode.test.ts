import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OpencodeAdapter } from './opencode.js';
import type { AgentAdapterOptions } from './types.js';

const tmpRepo = join(
  tmpdir(),
  'opencode-adapter-test-' + Math.random().toString(36).slice(2),
);

const baseOpts: AgentAdapterOptions = {
  repoDir: tmpRepo,
  agentName: 'my-agent',
  prefix: 'MY_AGENT',
  mcpUrl: 'https://mcp.themolt.net/mcp',
  clientId: 'cid',
  clientSecret: 'csec',
  appSlug: 'my-app',
  appId: '2878569',
  pemPath: '/tmp/my-app.pem',
  installationId: '99999',
};

beforeEach(async () => {
  await mkdir(tmpRepo, { recursive: true });
});

afterEach(async () => {
  await rm(tmpRepo, { recursive: true, force: true });
});

describe('OpencodeAdapter.writeMcpConfig', () => {
  it('creates opencode.json with a remote mcp server using {env:} headers', async () => {
    const adapter = new OpencodeAdapter();
    await adapter.writeMcpConfig(baseOpts);

    const parsed = JSON.parse(
      await readFile(join(tmpRepo, 'opencode.json'), 'utf-8'),
    );
    expect(parsed.$schema).toBe('https://opencode.ai/config.json');
    expect(parsed.mcp['my-agent']).toMatchObject({
      type: 'remote',
      url: 'https://mcp.themolt.net/mcp',
      enabled: true,
      headers: {
        'X-Client-Id': '{env:MY_AGENT_CLIENT_ID}',
        'X-Client-Secret': '{env:MY_AGENT_CLIENT_SECRET}',
      },
    });
  });

  it('merges into an existing opencode.json, preserving other keys', async () => {
    await writeFile(
      join(tmpRepo, 'opencode.json'),
      JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        theme: 'dark',
        mcp: { existing: { type: 'remote', url: 'https://example.com' } },
      }),
      'utf-8',
    );

    const adapter = new OpencodeAdapter();
    await adapter.writeMcpConfig(baseOpts);

    const parsed = JSON.parse(
      await readFile(join(tmpRepo, 'opencode.json'), 'utf-8'),
    );
    // Unrelated keys preserved
    expect(parsed.theme).toBe('dark');
    // Existing server preserved
    expect(parsed.mcp.existing.url).toBe('https://example.com');
    // New server added
    expect(parsed.mcp['my-agent'].url).toBe('https://mcp.themolt.net/mcp');
  });
});

describe('OpencodeAdapter.writeRules', () => {
  it('writes the gh-token rule and registers it in instructions', async () => {
    const adapter = new OpencodeAdapter();
    await adapter.writeRules(baseOpts);

    const rule = await readFile(
      join(tmpRepo, '.opencode', 'rules', 'legreffier-gh.md'),
      'utf-8',
    );
    expect(rule).toContain('git rev-parse --show-toplevel');
    expect(rule).toContain('moltnet github token');

    const parsed = JSON.parse(
      await readFile(join(tmpRepo, 'opencode.json'), 'utf-8'),
    );
    expect(parsed.instructions).toContain('.opencode/rules/legreffier-gh.md');
  });

  it('does not duplicate the instructions entry on re-run', async () => {
    const adapter = new OpencodeAdapter();
    await adapter.writeRules(baseOpts);
    await adapter.writeRules(baseOpts);

    const parsed = JSON.parse(
      await readFile(join(tmpRepo, 'opencode.json'), 'utf-8'),
    );
    expect(
      parsed.instructions.filter(
        (p: string) => p === '.opencode/rules/legreffier-gh.md',
      ),
    ).toHaveLength(1);
  });

  it('preserves an mcp block written before the rules step', async () => {
    const adapter = new OpencodeAdapter();
    await adapter.writeMcpConfig(baseOpts);
    await adapter.writeRules(baseOpts);

    const parsed = JSON.parse(
      await readFile(join(tmpRepo, 'opencode.json'), 'utf-8'),
    );
    expect(parsed.mcp['my-agent'].type).toBe('remote');
    expect(parsed.instructions).toContain('.opencode/rules/legreffier-gh.md');
  });
});

describe('OpencodeAdapter.writeSettings', () => {
  it('is a no-op (credentials come from the shared env file)', async () => {
    const adapter = new OpencodeAdapter();
    await adapter.writeSettings(baseOpts);
    // No opencode.json or .opencode dir should be created by writeSettings.
    await expect(stat(join(tmpRepo, 'opencode.json'))).rejects.toThrow();
  });
});
