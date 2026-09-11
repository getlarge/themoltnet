import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { SecretProviderRegistry } from '@themoltnet/sdk';
import { FileSecretProvider } from '@themoltnet/sdk/node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentServerStore } from '../lib/agent-server/store.js';
import { OAuthProviderService } from '../lib/oauth-provider.js';
import { ProviderConfigurationService } from '../lib/provider-configuration.js';
import { browserLaunchCommand, runProviders } from './providers.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function fixture(
  options: {
    login?: ModelRuntime['login'];
    logout?: ModelRuntime['logout'];
    fetchImpl?: typeof fetch;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'providers-cli-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const store = new AgentServerStore(root).ensure();
  const secrets = new FileSecretProvider({
    root: store.secretsDir,
    writable: true,
  });
  const configuration = new ProviderConfigurationService({
    store,
    secrets,
    secretProviders: new SecretProviderRegistry().register(secrets),
    fetchImpl: options.fetchImpl,
  });
  const modelRuntime = {
    getProviders: () => [
      { id: 'anthropic', name: 'Anthropic', auth: { oauth: {} } },
      { id: 'openai-codex', name: 'OpenAI Codex', auth: { oauth: {} } },
    ],
    login: options.login ?? vi.fn().mockResolvedValue({}),
    logout: options.logout ?? vi.fn().mockResolvedValue(undefined),
  } as unknown as ModelRuntime;
  const oauth = await OAuthProviderService.create({
    authPath: store.piAuthJsonPath,
    modelRuntime,
  });
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    root,
    store,
    configuration,
    modelRuntime,
    stdout,
    stderr,
    dependencies: {
      configuration,
      oauth,
      envRoot: root,
      stdout: (value: string) => stdout.push(value),
      stderr: (value: string) => stderr.push(value),
    },
  };
}

describe('moltnet-agent providers', () => {
  it.each([
    { stdinIsTTY: true, stdoutIsTTY: true, accepted: false },
    { stdinIsTTY: true, stdoutIsTTY: false, accepted: false },
    { stdinIsTTY: false, stdoutIsTTY: true, accepted: true },
    { stdinIsTTY: false, stdoutIsTTY: false, accepted: true },
  ])(
    'uses stdin TTY state for secret input: $stdinIsTTY/$stdoutIsTTY',
    async ({ stdinIsTTY, stdoutIsTTY, accepted }) => {
      const test = await fixture();
      const readStdin = vi.fn(() => Promise.resolve('redirected-secret\n'));

      const result = await runProviders(
        [
          'set',
          'redirect-test',
          '--base-url',
          'https://provider.example/v1',
          '--api-key-stdin',
        ],
        {
          ...test.dependencies,
          stdinIsTTY,
          stdoutIsTTY,
          readStdin,
        },
      );

      expect(result).toBe(accepted ? 0 : 1);
      expect(readStdin).toHaveBeenCalledTimes(accepted ? 1 : 0);
      expect(test.stderr.join('\n')).not.toContain('redirected-secret');
    },
  );

  it('parses set patches, reads the API key from stdin, and preserves omissions', async () => {
    const test = await fixture();
    expect(
      await runProviders(
        [
          'set',
          'ollama-cloud',
          '--base-url',
          'https://ollama.com/v1',
          '--model',
          'first',
          '--api-key-stdin',
        ],
        {
          ...test.dependencies,
          interactive: false,
          readStdin: () => Promise.resolve('secret-from-stdin\n'),
        },
      ),
    ).toBe(0);
    expect(
      await runProviders(['set', 'ollama-cloud', '--model', 'second'], {
        ...test.dependencies,
        interactive: false,
      }),
    ).toBe(0);

    expect(test.configuration.list()['ollama-cloud']).toMatchObject({
      api: 'openai-completions',
      baseUrl: 'https://ollama.com/v1',
      models: ['second'],
      hasApiKey: true,
    });
    expect(JSON.stringify(test.configuration.list())).not.toContain(
      'secret-from-stdin',
    );
  });

  it('prints stable JSON keys for configured and OAuth providers', async () => {
    const test = await fixture();
    await test.configuration.set('local', {
      baseUrl: 'http://localhost:11434/v1',
    });

    expect(
      await runProviders(['list', '--json'], {
        ...test.dependencies,
        interactive: false,
      }),
    ).toBe(0);

    expect(JSON.parse(test.stdout.at(-1) ?? '{}')).toMatchObject({
      configuredProviders: { local: { hasApiKey: false } },
      oauthProviders: [
        { id: 'anthropic', connected: false },
        { id: 'openai-codex', connected: false },
      ],
    });
  });

  it('emits safe production service diagnostics on stderr', async () => {
    const test = await fixture();
    test.store.writeProviders({
      remote: {
        api: 'openai-completions',
        baseUrl: 'https://provider.example/v1',
        envName: 'MOLTNET_PROVIDER_REMOTE_API_KEY',
        models: [],
        apiKeyRef: 'file:missing-provider-key',
      },
    });

    expect(
      await runProviders(['discover', 'remote'], {
        oauth: test.dependencies.oauth,
        envRoot: test.root,
        interactive: false,
        stdout: test.dependencies.stdout,
        stderr: test.dependencies.stderr,
      }),
    ).toBe(1);

    expect(JSON.parse(test.stderr[0] ?? '{}')).toMatchObject({
      level: 'warn',
      code: 'agent_server_provider_secret_unavailable',
      providerId: 'remote',
    });
    expect(test.stderr.join('\n')).not.toContain('missing-provider-key');
  });

  it('requires confirmation interactively or --yes for destructive commands', async () => {
    const test = await fixture();
    await test.configuration.set('local', {
      baseUrl: 'http://localhost:11434/v1',
    });

    expect(
      await runProviders(['remove', 'local'], {
        ...test.dependencies,
        interactive: false,
      }),
    ).toBe(1);
    expect(test.configuration.list()).toHaveProperty('local');
    expect(
      await runProviders(['remove', 'local', '--yes'], {
        ...test.dependencies,
        interactive: false,
      }),
    ).toBe(0);
    expect(test.configuration.list()).not.toHaveProperty('local');
  });

  it('discovers merged model catalogs and saves only when requested', async () => {
    const fetchImpl = vi.fn<typeof fetch>((url) => {
      const href =
        typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      const body = href.endsWith('/api/tags')
        ? { models: [{ name: 'gemma4:31b-cloud' }] }
        : { data: [{ id: 'local-model' }] };
      return Promise.resolve(new Response(JSON.stringify(body)));
    });
    const test = await fixture({ fetchImpl });
    await test.configuration.set('ollama-cloud', {
      baseUrl: 'https://ollama.com/v1',
      models: ['existing'],
    });

    expect(
      await runProviders(['discover', 'ollama-cloud', '--json'], {
        ...test.dependencies,
        interactive: false,
      }),
    ).toBe(0);
    expect(JSON.parse(test.stdout.at(-1) ?? '{}')).toEqual({
      models: ['gemma4:31b-cloud', 'local-model'],
    });
    expect(test.configuration.list()['ollama-cloud']?.models).toEqual([
      'existing',
    ]);

    expect(
      await runProviders(['discover', 'ollama-cloud', '--save'], {
        ...test.dependencies,
        interactive: false,
      }),
    ).toBe(0);
    expect(test.configuration.list()['ollama-cloud']?.models).toEqual([
      'gemma4:31b-cloud',
      'local-model',
    ]);
  });

  it('uses ModelRuntime logout after non-interactive confirmation', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const test = await fixture({ logout });

    expect(
      await runProviders(['logout', 'anthropic', '--yes'], {
        ...test.dependencies,
        interactive: false,
      }),
    ).toBe(0);
    expect(logout).toHaveBeenCalledWith('anthropic');
  });

  it('surfaces browser and device-code callbacks and selects auth methods', async () => {
    const login = vi.fn<ModelRuntime['login']>(
      async (_providerId, _type, interaction) => {
        interaction.notify({
          type: 'auth_url',
          url: 'https://provider.example/authorize',
        });
        interaction.notify({
          type: 'device_code',
          verificationUri: 'https://provider.example/device',
          userCode: 'ABCD-1234',
        });
        await expect(
          interaction.prompt({
            type: 'select',
            message: 'Choose a method',
            options: [
              { id: 'browser', label: 'Browser' },
              { id: 'device', label: 'Device code' },
            ],
            signal: new AbortController().signal,
          }),
        ).resolves.toBe('device');
        return { type: 'oauth', access: 'test', refresh: 'test', expires: 1 };
      },
    );
    const test = await fixture({ login });
    const opened: string[] = [];

    expect(
      await runProviders(['login', 'openai-codex', '--auth-method', 'device'], {
        ...test.dependencies,
        interactive: true,
        question: () => Promise.resolve('unused'),
        openUrl: (url) => {
          opened.push(url);
        },
      }),
    ).toBe(0);
    expect(opened).toEqual(['https://provider.example/authorize']);
    expect(test.stderr.join('\n')).toContain('ABCD-1234');
  });

  it('warns safely when automatic browser launch fails', async () => {
    const login = vi.fn<ModelRuntime['login']>(
      async (_providerId, _type, interaction) => {
        interaction.notify({
          type: 'auth_url',
          url: 'https://provider.example/authorize?state=safe',
        });
        return { type: 'oauth', access: 'test', refresh: 'test', expires: 1 };
      },
    );
    const test = await fixture({ login });

    expect(
      await runProviders(['login', 'anthropic'], {
        ...test.dependencies,
        interactive: true,
        openUrl: () => Promise.reject(new Error('launch failed secret=bad')),
      }),
    ).toBe(0);
    await vi.waitFor(() =>
      expect(test.stderr).toContain(
        'Could not open the browser automatically; open the authorization URL above manually.',
      ),
    );
    expect(test.stderr.join('\n')).not.toContain('secret=bad');
  });

  it('cancels pending login and releases the OAuth lock for a retry', async () => {
    const login = vi
      .fn<ModelRuntime['login']>()
      .mockImplementationOnce((_providerId, _type, interaction) => {
        return new Promise((_resolve, reject) => {
          interaction.signal?.addEventListener(
            'abort',
            () => reject(new Error('cancelled with secret=hidden')),
            { once: true },
          );
        });
      })
      .mockResolvedValue({
        type: 'oauth',
        access: 'retry',
        refresh: 'retry',
        expires: 1,
      });
    const test = await fixture({ login });
    const controller = new AbortController();

    const pending = runProviders(['login', 'anthropic'], {
      ...test.dependencies,
      interactive: true,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(login).toHaveBeenCalledOnce());
    controller.abort(new Error('SIGINT'));

    await expect(pending).resolves.toBe(1);
    expect(test.stderr.at(-1)).toBe('Provider operation interrupted.');
    expect(test.stderr.join('\n')).not.toContain('secret=hidden');
    await expect(
      runProviders(['login', 'anthropic'], {
        ...test.dependencies,
        interactive: true,
      }),
    ).resolves.toBe(0);
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('cancels pending discovery and permits a subsequent discovery', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce((_url, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('cancelled with api_key=hidden')),
            { once: true },
          );
        });
      })
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: 'retry-model' }] })),
      );
    const test = await fixture({ fetchImpl });
    await test.configuration.set('remote', {
      baseUrl: 'https://provider.example/v1',
    });
    const controller = new AbortController();

    const pending = runProviders(['discover', 'remote'], {
      ...test.dependencies,
      interactive: false,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    controller.abort(new Error('SIGINT'));

    await expect(pending).resolves.toBe(1);
    expect(test.stderr.at(-1)).toBe('Provider operation interrupted.');
    expect(test.stderr.join('\n')).not.toContain('api_key=hidden');
    await expect(
      runProviders(['discover', 'remote'], {
        ...test.dependencies,
        interactive: false,
      }),
    ).resolves.toBe(0);
    expect(test.stdout.at(-1)).toBe('retry-model');
  });

  it('fails login on non-TTY input and redacts upstream error messages', async () => {
    const login = vi.fn<ModelRuntime['login']>(() =>
      Promise.reject(new Error('access_token=super-secret')),
    );
    const test = await fixture({ login });

    expect(
      await runProviders(['login', 'anthropic'], {
        ...test.dependencies,
        interactive: false,
      }),
    ).toBe(1);
    expect(login).not.toHaveBeenCalled();
    expect(
      await runProviders(['login', 'anthropic'], {
        ...test.dependencies,
        interactive: true,
        question: () => Promise.resolve(''),
        openUrl: () => undefined,
      }),
    ).toBe(1);
    expect(test.stderr.join('\n')).not.toContain('super-secret');
    expect(test.stderr.at(-1)).toBe('Provider operation failed.');
  });
});

describe('OAuth browser launcher', () => {
  it('passes adversarial Windows URLs directly to explorer.exe', () => {
    const url =
      'https://provider.example/authorize?state=abc&next=calc.exe|ignored';

    expect(browserLaunchCommand('win32', url)).toEqual({
      executable: 'explorer.exe',
      args: [url],
    });
  });
});
