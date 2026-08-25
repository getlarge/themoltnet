import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { assertSecretGuardCapabilityMock } = vi.hoisted(() => ({
  assertSecretGuardCapabilityMock: vi.fn(),
}));

vi.mock('../secret-guard-capability.js', () => ({
  assertSecretGuardCapability: assertSecretGuardCapabilityMock,
}));

import { OPENCODE_SECRET_GUARD_PLUGIN, OpencodeAdapter } from './opencode.js';
import type { AgentAdapterOptions } from './types.js';

interface GeneratedSecretGuardHook {
  'tool.execute.before': (
    input: { tool: string },
    output: { args: unknown },
  ) => Promise<void>;
}

type GeneratedSecretGuardPlugin = () => Promise<GeneratedSecretGuardHook>;

interface GeneratedSpawnResult {
  exitCode: number;
  stdout: { toString(): string };
}

type GeneratedSpawnSync = (
  command: string[],
  options: { stdin: string },
) => GeneratedSpawnResult;

function executeGeneratedSecretGuardPlugin(
  env: Record<string, string | undefined>,
  spawnSync: GeneratedSpawnSync,
): GeneratedSecretGuardPlugin {
  const javascript = transpileModule(OPENCODE_SECRET_GUARD_PLUGIN, {
    compilerOptions: {
      module: ModuleKind.CommonJS,
      target: ScriptTarget.ES2022,
    },
  }).outputText;
  const generatedModule: { exports: Record<string, unknown> } = {
    exports: {},
  };
  runInNewContext(javascript, {
    Bun: { env, spawnSync },
    exports: generatedModule.exports,
    module: generatedModule,
  });
  return generatedModule.exports
    .MoltNetSecretGuard as GeneratedSecretGuardPlugin;
}

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
  it('installs the fail-closed secret guard plugin', async () => {
    const adapter = new OpencodeAdapter();
    await adapter.writeSettings(baseOpts);
    expect(assertSecretGuardCapabilityMock).toHaveBeenCalledOnce();
    const pluginPath = join(
      tmpRepo,
      '.opencode',
      'plugins',
      'moltnet-secret-guard.ts',
    );
    expect(await readFile(pluginPath, 'utf-8')).toBe(
      OPENCODE_SECRET_GUARD_PLUGIN,
    );
    expect((await stat(pluginPath)).isFile()).toBe(true);
  });

  it('does not install a plugin when the released CLI lacks the guard', async () => {
    assertSecretGuardCapabilityMock.mockRejectedValueOnce(
      new Error('update moltnet'),
    );

    await expect(new OpencodeAdapter().writeSettings(baseOpts)).rejects.toThrow(
      'update moltnet',
    );
    await expect(
      stat(join(tmpRepo, '.opencode', 'plugins', 'moltnet-secret-guard.ts')),
    ).rejects.toThrow();
  });

  it('returns before inspecting arguments or spawning in inactive sessions', async () => {
    const spawnSync = vi.fn<GeneratedSpawnSync>();
    const plugin = executeGeneratedSecretGuardPlugin({}, spawnSync);
    const hooks = await plugin();
    const output = Object.defineProperty({}, 'args', {
      get: () => {
        throw new Error('inactive plugin inspected tool arguments');
      },
    });

    await hooks['tool.execute.before'](
      { tool: 'write' },
      output as { args: unknown },
    );

    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('executes the guard with normalized arguments in active sessions', async () => {
    const spawnSync = vi.fn<GeneratedSpawnSync>(() => ({
      exitCode: 0,
      stdout: { toString: () => '' },
    }));
    const plugin = executeGeneratedSecretGuardPlugin(
      { GIT_CONFIG_GLOBAL: '.moltnet/my-agent/gitconfig' },
      spawnSync,
    );
    const hooks = await plugin();

    await hooks['tool.execute.before'](
      { tool: 'write' },
      {
        args: {
          filePath: '.moltnet/my-agent/moltnet.json',
          patchText: 'redacted patch',
          content: 'must not be forwarded',
        },
      },
    );

    expect(spawnSync).toHaveBeenCalledOnce();
    const [command, options] = spawnSync.mock.calls[0];
    expect(command).toEqual(['moltnet', 'secrets', 'guard']);
    expect(JSON.parse(options.stdin)).toEqual({
      tool_name: 'write',
      tool_input: {
        filePath: '.moltnet/my-agent/moltnet.json',
        patchText: 'redacted patch',
      },
    });
  });
});
