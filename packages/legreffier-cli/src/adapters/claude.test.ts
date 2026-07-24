import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CLAUDE_GITHUB_GUARD_HOOK_COMMAND,
  CLAUDE_GITHUB_GUARD_HOOK_SCRIPT,
} from '../setup.js';
import { ClaudeAdapter } from './claude.js';
import type { AgentAdapterOptions } from './types.js';

const tmpRepo = join(
  tmpdir(),
  'claude-adapter-test-' + Math.random().toString(36).slice(2),
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

describe('ClaudeAdapter.writeSettings', () => {
  it('registers the shared hook and keeps local settings hook-free', async () => {
    const adapter = new ClaudeAdapter();
    await adapter.writeSettings(baseOpts);

    const settings = JSON.parse(
      await readFile(join(tmpRepo, '.claude', 'settings.json'), 'utf-8'),
    );
    expect(settings.hooks.PreToolUse).toEqual([
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: CLAUDE_GITHUB_GUARD_HOOK_COMMAND,
          },
        ],
      },
    ]);

    const local = JSON.parse(
      await readFile(join(tmpRepo, '.claude', 'settings.local.json'), 'utf-8'),
    );
    expect(local.hooks).toBeUndefined();

    const hookPath = join(
      tmpRepo,
      '.claude',
      'hooks',
      'moltnet-github-guard.sh',
    );
    expect(await readFile(hookPath, 'utf-8')).toBe(
      CLAUDE_GITHUB_GUARD_HOOK_SCRIPT,
    );
    expect((await stat(hookPath)).mode & 0o111).not.toBe(0);
  });

  it('preserves existing shared hooks and remains idempotent', async () => {
    const dir = join(tmpRepo, '.claude');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: 'bootstrap' }] },
          ],
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [{ type: 'command', command: 'custom-guard' }],
            },
          ],
        },
      }),
      'utf-8',
    );

    const adapter = new ClaudeAdapter();
    await adapter.writeSettings(baseOpts);
    await adapter.writeSettings(baseOpts);

    const settings = JSON.parse(
      await readFile(join(dir, 'settings.json'), 'utf-8'),
    );
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0].hooks).toEqual([
      { type: 'command', command: 'custom-guard' },
      { type: 'command', command: CLAUDE_GITHUB_GUARD_HOOK_COMMAND },
    ]);
  });
});
