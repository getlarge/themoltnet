/**
 * Subscription OAuth brokering tests (#2061 slice 4): the login flow runs
 * against an injected fake runner — no real provider traffic — and the
 * HTTP surface is exercised end to end through the paired serve server.
 */
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import {
  createNodeSecretProviderRegistry,
  FileSecretProvider,
} from '@themoltnet/sdk/node';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PairingService } from './pairing.js';
import {
  type LoginCallbacksLike,
  ProviderLoginService,
} from './provider-login.js';
import { RunManager, type SpawnImpl } from './runs.js';
import { buildServeServer, SERVE_TOKEN_HEADER } from './server.js';
import { ServeStore } from './store.js';

const CONSOLE_ORIGIN = 'https://console.themolt.net';
const HOST = '127.0.0.1:17374';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

interface LoginHarness {
  callbacks: LoginCallbacksLike | null;
  finish: (error?: Error) => void;
}

function makeHarness(): {
  harness: LoginHarness;
  runLogin: (id: string, callbacks: LoginCallbacksLike) => Promise<void>;
} {
  const harness: LoginHarness = {
    callbacks: null,
    finish: () => undefined,
  };
  const runLogin = (_id: string, callbacks: LoginCallbacksLike) => {
    harness.callbacks = callbacks;
    return new Promise<void>((resolvePromise, rejectPromise) => {
      harness.finish = (error?: Error) =>
        error ? rejectPromise(error) : resolvePromise();
    });
  };
  return { harness, runLogin };
}

async function fixture(options: {
  runLogin: (id: string, callbacks: LoginCallbacksLike) => Promise<void>;
  connected?: Set<string>;
  discoverFetch?: typeof fetch;
}): Promise<{ app: FastifyInstance; token: string }> {
  const temp = mkdtempSync(join(tmpdir(), 'serve-subs-'));
  const store = new ServeStore(join(temp, 'moltnet')).ensure();
  const secrets = new FileSecretProvider({
    root: store.secretsDir,
    writable: true,
  });
  const secretProviders = createNodeSecretProviderRegistry().register(secrets);
  const externalSecretProviders = createNodeSecretProviderRegistry();
  const connected = options.connected ?? new Set<string>();
  const subscriptions = new ProviderLoginService({
    authPath: store.piAuthJsonPath,
    listProviders: () => [
      { id: 'anthropic', name: 'Anthropic' },
      { id: 'github-copilot', name: 'GitHub Copilot' },
    ],
    runLogin: options.runLogin,
    isConnected: (id) => connected.has(id),
  });
  const runs = new RunManager({
    store,
    secretProviders,
    externalSecretProviders,
    baseEnv: {},
    entrypoint: { execPath: '/bin/node', execArgv: [], scriptPath: '/m.js' },
    spawnImpl: (() =>
      new EventEmitter() as unknown as ChildProcess) as SpawnImpl,
  });
  const app = buildServeServer({
    store,
    secrets,
    secretProviders,
    externalSecretProviders,
    pairing: new PairingService(),
    runs,
    subscriptions,
    allowedOrigins: [CONSOLE_ORIGIN],
    selfOrigin: 'http://127.0.0.1:17374',
    defaultApiUrl: 'https://api.example',
    version: 'test',
    ...(options.discoverFetch ? { discoverFetch: options.discoverFetch } : {}),
  });
  await app.ready();
  cleanups.push(async () => {
    await app.close();
    rmSync(temp, { recursive: true, force: true });
  });

  // Pair once so /v1 routes are reachable.
  const started = await app.inject({
    method: 'POST',
    url: '/v1/pairings',
    headers: { host: HOST, origin: CONSOLE_ORIGIN },
  });
  const { pairingId } = started.json<{ pairingId: string }>();
  const approval = await app.inject({
    method: 'GET',
    url: `/pairings/${pairingId}`,
    headers: {
      host: HOST,
      'sec-fetch-site': 'none',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
    },
  });
  const confirmToken = approval.body.match(
    /name="confirmToken" value="([^"]+)"/u,
  )?.[1];
  await app.inject({
    method: 'POST',
    url: `/pairings/${pairingId}/confirm`,
    headers: {
      host: HOST,
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload: new URLSearchParams({
      confirmToken: confirmToken ?? '',
    }).toString(),
  });
  const claimed = await app.inject({
    method: 'POST',
    url: `/v1/pairings/${pairingId}/claim`,
    headers: { host: HOST, origin: CONSOLE_ORIGIN },
  });
  return { app, token: claimed.json<{ token: string }>().token };
}

function authedHeaders(token: string): Record<string, string> {
  return { host: HOST, origin: CONSOLE_ORIGIN, [SERVE_TOKEN_HEADER]: token };
}

function writeAuthFile(
  authPath: string,
  credentials: Record<string, unknown>,
): void {
  mkdirSync(dirname(authPath), { recursive: true });
  writeFileSync(authPath, `${JSON.stringify(credentials)}\n`, { mode: 0o600 });
}

function readAuthFile(authPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(authPath, 'utf8')) as Record<string, unknown>;
}

describe('serve subscriptions', () => {
  it('adapts the production ModelRuntime OAuth discovery and login callbacks', async () => {
    const authPath = join(
      mkdtempSync(join(tmpdir(), 'serve-subs-runtime-')),
      'auth.json',
    );
    cleanups.push(() =>
      rmSync(dirname(authPath), { recursive: true, force: true }),
    );
    const login = vi.fn(
      async (
        _id: string,
        _method: string,
        interaction: Parameters<ModelRuntime['login']>[2],
      ) => {
        interaction.notify({
          type: 'auth_url',
          url: 'https://provider.example/authorize',
        });
        await new Promise<void>(() => {});
      },
    );
    const runtime = {
      getProviders: () => [
        { id: 'anthropic', name: 'Anthropic', auth: { oauth: {} } },
        { id: 'api-key-only', name: 'API key', auth: {} },
      ],
      login,
    } as unknown as ModelRuntime;
    const create = vi.spyOn(ModelRuntime, 'create').mockResolvedValue(runtime);

    const service = await ProviderLoginService.create({ authPath });
    expect(service.list()).toEqual([
      { id: 'anthropic', name: 'Anthropic', connected: false },
    ]);
    await expect(service.start('anthropic')).resolves.toMatchObject({
      status: 'pending',
      authUrl: 'https://provider.example/authorize',
    });
    expect(create).toHaveBeenCalledWith({ authPath, refreshOnCreate: false });
    expect(login).toHaveBeenCalledWith(
      'anthropic',
      'oauth',
      expect.any(Object),
    );
  });

  it('lists providers with connection state', async () => {
    const { runLogin } = makeHarness();
    const { app, token } = await fixture({
      runLogin,
      connected: new Set(['github-copilot']),
    });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/subscriptions',
      headers: authedHeaders(token),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { id: 'anthropic', name: 'Anthropic', connected: false },
      { id: 'github-copilot', name: 'GitHub Copilot', connected: true },
    ]);
  });

  it('brokers a browser-redirect login: authUrl, pending, completed', async () => {
    const { harness, runLogin } = makeHarness();
    const { app, token } = await fixture({ runLogin });

    const startPromise = app.inject({
      method: 'POST',
      url: '/v1/subscriptions/anthropic/login',
      headers: authedHeaders(token),
    });
    // The flow surfaces its authorize URL asynchronously.
    await new Promise((resolvePromise) => {
      setTimeout(() => resolvePromise(undefined), 10);
    });
    harness.callbacks?.onAuth({
      url: 'https://claude.ai/oauth/authorize?x=1',
      instructions: 'Sign in with your Claude account',
    });
    const startResponse = await startPromise;
    expect(startResponse.statusCode).toBe(201);
    expect(startResponse.json()).toMatchObject({
      providerId: 'anthropic',
      status: 'pending',
      authUrl: 'https://claude.ai/oauth/authorize?x=1',
      instructions: 'Sign in with your Claude account',
    });

    harness.finish();
    await new Promise((resolvePromise) => {
      setImmediate(() => resolvePromise(undefined));
    });
    const statusResponse = await app.inject({
      method: 'GET',
      url: '/v1/subscriptions/anthropic/login',
      headers: authedHeaders(token),
    });
    expect(statusResponse.json()).toMatchObject({ status: 'completed' });
  });

  it('brokers a device-code login and surfaces failures', async () => {
    const { harness, runLogin } = makeHarness();
    const { app, token } = await fixture({ runLogin });

    const startPromise = app.inject({
      method: 'POST',
      url: '/v1/subscriptions/github-copilot/login',
      headers: authedHeaders(token),
    });
    await new Promise((resolvePromise) => {
      setTimeout(() => resolvePromise(undefined), 10);
    });
    harness.callbacks?.onDeviceCode({
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
    });
    const startResponse = await startPromise;
    expect(startResponse.json()).toMatchObject({
      status: 'pending',
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
    });

    harness.finish(new Error('access_denied'));
    await new Promise((resolvePromise) => {
      setImmediate(() => resolvePromise(undefined));
    });
    const statusResponse = await app.inject({
      method: 'GET',
      url: '/v1/subscriptions/github-copilot/login',
      headers: authedHeaders(token),
    });
    expect(statusResponse.json()).toMatchObject({
      status: 'failed',
      error: 'Subscription sign-in failed. Start again to retry.',
    });
  });

  it('cancels a pending login: aborts the flow and clears state', async () => {
    const { harness, runLogin } = makeHarness();
    const { app, token } = await fixture({ runLogin });

    const startPromise = app.inject({
      method: 'POST',
      url: '/v1/subscriptions/anthropic/login',
      headers: authedHeaders(token),
    });
    await new Promise((resolvePromise) => {
      setTimeout(() => resolvePromise(undefined), 10);
    });
    harness.callbacks?.onAuth({ url: 'https://claude.ai/oauth/x' });
    await startPromise;
    expect(harness.callbacks?.signal?.aborted).toBe(false);

    const cancelled = await app.inject({
      method: 'DELETE',
      url: '/v1/subscriptions/anthropic/login',
      headers: authedHeaders(token),
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toEqual({
      providerId: 'anthropic',
      status: 'cancelled',
    });
    expect(harness.callbacks?.signal?.aborted).toBe(true);

    const gone = await app.inject({
      method: 'GET',
      url: '/v1/subscriptions/anthropic/login',
      headers: authedHeaders(token),
    });
    expect(gone.statusCode).toBe(404);
  });

  it('answers method-selection prompts with the device-code option', async () => {
    const { harness, runLogin } = makeHarness();
    const { app, token } = await fixture({ runLogin });
    const startPromise = app.inject({
      method: 'POST',
      url: '/v1/subscriptions/anthropic/login',
      headers: authedHeaders(token),
    });
    await new Promise((resolvePromise) => {
      setTimeout(() => resolvePromise(undefined), 10);
    });
    await expect(
      harness.callbacks?.onSelect({
        message: 'Select OpenAI Codex login method:',
        options: [
          { id: 'browser', label: 'Browser login (default)' },
          { id: 'device_code', label: 'Device code login (headless)' },
        ],
      }),
    ).resolves.toBe('device_code');
    await expect(
      harness.callbacks?.onSelect({
        message: 'pick one',
        options: [{ id: 'only', label: 'Only option' }],
      }),
    ).resolves.toBe('only');
    harness.finish();
    await startPromise;
  });

  it('404s unknown providers and missing logins', async () => {
    const { runLogin } = makeHarness();
    const { app, token } = await fixture({ runLogin });
    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/subscriptions/nope/login',
      headers: authedHeaders(token),
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ code: 'provider_unknown' });

    const missing = await app.inject({
      method: 'GET',
      url: '/v1/subscriptions/anthropic/login',
      headers: authedHeaders(token),
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'login_not_found' });
  });

  it('reads connection state back from the production auth.json storage', () => {
    const temp = mkdtempSync(join(tmpdir(), 'serve-subs-auth-'));
    cleanups.push(() => rmSync(temp, { recursive: true, force: true }));
    const authPath = join(temp, 'auth.json');
    writeAuthFile(authPath, {
      anthropic: { type: 'api_key', key: 'persisted-locally' },
    });
    const service = new ProviderLoginService({
      authPath,
      listProviders: () => [{ id: 'anthropic', name: 'Anthropic' }],
    });

    expect(service.list()).toEqual([
      { id: 'anthropic', name: 'Anthropic', connected: true },
    ]);
  });

  it('restores prior credentials when a cancelled flow persists late', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'serve-subs-restore-'));
    cleanups.push(() => rmSync(temp, { recursive: true, force: true }));
    const authPath = join(temp, 'auth.json');
    writeAuthFile(authPath, {
      anthropic: { type: 'api_key', key: 'previous-credential' },
    });
    let callbacks: LoginCallbacksLike | undefined;
    let finish: (() => void) | undefined;
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const service = new ProviderLoginService({
      authPath,
      listProviders: () => [{ id: 'anthropic', name: 'Anthropic' }],
      logger,
      runLogin: (_providerId, nextCallbacks) => {
        callbacks = nextCallbacks;
        return new Promise<void>((resolvePromise) => {
          finish = () => {
            writeAuthFile(authPath, {
              anthropic: {
                type: 'api_key',
                key: 'late-new-credential',
              },
            });
            resolvePromise();
          };
        });
      },
    });
    const starting = service.start('anthropic');
    await vi.waitFor(() => expect(callbacks).toBeDefined());
    callbacks?.onAuth({ url: 'https://provider.example/authorize' });
    await starting;

    service.cancel('anthropic');
    finish?.();
    await vi.waitFor(() =>
      expect(readAuthFile(authPath)['anthropic']).toEqual({
        type: 'api_key',
        key: 'previous-credential',
      }),
    );
    expect(callbacks?.signal?.aborted).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: expect.any(String) as string,
        providerId: 'anthropic',
        transition: 'cancelled',
      }),
      'Subscription login invalidated',
    );
  });

  it('expires and aborts pending flows without retaining late credentials', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'serve-subs-expiry-'));
    cleanups.push(() => rmSync(temp, { recursive: true, force: true }));
    const authPath = join(temp, 'auth.json');
    let now = 0;
    let callbacks: LoginCallbacksLike | undefined;
    let finish: (() => void) | undefined;
    const service = new ProviderLoginService({
      authPath,
      listProviders: () => [{ id: 'anthropic', name: 'Anthropic' }],
      now: () => now,
      runLogin: (_providerId, nextCallbacks) => {
        callbacks = nextCallbacks;
        return new Promise<void>((resolvePromise) => {
          finish = () => {
            writeAuthFile(authPath, {
              anthropic: {
                type: 'api_key',
                key: 'late-expired-credential',
              },
            });
            resolvePromise();
          };
        });
      },
    });
    const starting = service.start('anthropic');
    await vi.waitFor(() => expect(callbacks).toBeDefined());
    callbacks?.onAuth({ url: 'https://provider.example/authorize' });
    await starting;

    now = 10 * 60 * 1000 + 1;
    expect(service.list()).toEqual([
      { id: 'anthropic', name: 'Anthropic', connected: false },
    ]);
    finish?.();
    await vi.waitFor(() =>
      expect(readAuthFile(authPath)['anthropic']).toBeUndefined(),
    );
    expect(callbacks?.signal?.aborted).toBe(true);
  });

  it('retains completed credentials after status expiry and shutdown', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'serve-subs-completed-'));
    cleanups.push(() => rmSync(temp, { recursive: true, force: true }));
    const authPath = join(temp, 'auth.json');
    let now = 0;
    const service = new ProviderLoginService({
      authPath,
      listProviders: () => [{ id: 'anthropic', name: 'Anthropic' }],
      isConnected: () => true,
      now: () => now,
      runLogin: (_providerId, callbacks) => {
        callbacks.onAuth({ url: 'https://provider.example/authorize' });
        writeAuthFile(authPath, {
          anthropic: { type: 'oauth', access: 'kept-after-login' },
        });
        return Promise.resolve();
      },
    });

    await service.start('anthropic');
    await vi.waitFor(() =>
      expect(service.status('anthropic').status).toBe('completed'),
    );
    now = 10 * 60 * 1000 + 1;
    service.list();
    service.close();

    expect(readAuthFile(authPath)['anthropic']).toEqual({
      type: 'oauth',
      access: 'kept-after-login',
    });
  });

  it('masks upstream failure messages and logs only bounded metadata', async () => {
    const { harness, runLogin } = makeHarness();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const service = new ProviderLoginService({
      authPath: '/unused/auth.json',
      listProviders: () => [{ id: 'anthropic', name: 'Anthropic' }],
      logger,
      runLogin,
    });
    const starting = service.start('anthropic');
    await vi.waitFor(() => expect(harness.callbacks).not.toBeNull());
    harness.callbacks?.onAuth({ url: 'https://provider.example/authorize' });
    await starting;
    harness.finish(new Error('access_token=super-secret-token'));
    await vi.waitFor(() =>
      expect(service.status('anthropic').status).toBe('failed'),
    );

    expect(service.status('anthropic').error).toBe(
      'Subscription sign-in failed. Start again to retry.',
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
      'super-secret-token',
    );
  });
});

describe('provider model discovery', () => {
  it('discovers via the OpenAI models endpoint with the key attached', async () => {
    const { runLogin } = makeHarness();
    const calls: { url: string; auth: string | null }[] = [];
    const discoverFetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      calls.push({
        url,
        auth:
          (init?.headers as Record<string, string> | undefined)?.[
            'authorization'
          ] ?? null,
      });
      return new Response(
        JSON.stringify({ data: [{ id: 'qwen3' }, { id: 'gpt-oss:120b' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    const { app, token } = await fixture({ runLogin, discoverFetch });
    const configured = await app.inject({
      method: 'PUT',
      url: '/v1/providers/ollama',
      headers: { ...authedHeaders(token), 'content-type': 'application/json' },
      payload: {
        api: 'openai-completions',
        baseUrl: 'https://ollama.com/v1',
        envName: 'MOLTNET_PROVIDER_OLLAMA_API_KEY',
        models: [],
        apiKey: 'sk-test',
      },
    });
    expect(configured.statusCode).toBe(200);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/providers/ollama/discover-models',
      headers: authedHeaders(token),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ models: ['gpt-oss:120b', 'qwen3'] });
    expect(calls[0]).toEqual({
      url: 'https://ollama.com/v1/models',
      auth: 'Bearer sk-test',
    });
  });

  it('falls back to the Ollama tags endpoint and 502s when nothing answers', async () => {
    const { runLogin } = makeHarness();
    const discoverFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) {
        return new Response(
          JSON.stringify({ models: [{ name: 'llama3.3:70b' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('nope', { status: 404 });
    }) as typeof fetch;
    const { app, token } = await fixture({ runLogin, discoverFetch });
    await app.inject({
      method: 'PUT',
      url: '/v1/providers/ollama-local',
      headers: { ...authedHeaders(token), 'content-type': 'application/json' },
      payload: {
        api: 'openai-completions',
        baseUrl: 'http://localhost:11434/v1',
        envName: 'MOLTNET_PROVIDER_OLLAMA_LOCAL_API_KEY',
        models: [],
      },
    });
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/providers/ollama-local/discover-models',
      headers: authedHeaders(token),
    });
    expect(ok.json()).toEqual({ models: ['llama3.3:70b'] });

    const dead = (async () =>
      new Response('nope', { status: 404 })) as unknown as typeof fetch;
    const second = await fixture({ runLogin, discoverFetch: dead });
    await second.app.inject({
      method: 'PUT',
      url: '/v1/providers/ollama-local',
      headers: {
        ...authedHeaders(second.token),
        'content-type': 'application/json',
      },
      payload: {
        api: 'openai-completions',
        baseUrl: 'http://localhost:11434/v1',
        envName: 'MOLTNET_PROVIDER_OLLAMA_LOCAL_API_KEY',
        models: [],
      },
    });
    const failed = await second.app.inject({
      method: 'POST',
      url: '/v1/providers/ollama-local/discover-models',
      headers: authedHeaders(second.token),
    });
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toMatchObject({ code: 'discovery_failed' });
  });

  it.each([
    [
      'discovery_unauthorized',
      (async () => new Response('denied', { status: 401 })) as typeof fetch,
    ],
    [
      'discovery_invalid_response',
      (async () =>
        new Response('not-json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as typeof fetch,
    ],
    [
      'discovery_unavailable',
      (async () => {
        throw new TypeError('connection refused');
      }) as typeof fetch,
    ],
  ])(
    'classifies model discovery failure as %s',
    async (code, discoverFetch) => {
      const { runLogin } = makeHarness();
      const { app, token } = await fixture({ runLogin, discoverFetch });
      await app.inject({
        method: 'PUT',
        url: '/v1/providers/custom',
        headers: {
          ...authedHeaders(token),
          'content-type': 'application/json',
        },
        payload: {
          api: 'openai-completions',
          baseUrl: 'https://provider.example/v1',
          envName: 'MOLTNET_PROVIDER_CUSTOM_API_KEY',
          models: [],
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/providers/custom/discover-models',
        headers: authedHeaders(token),
      });

      expect(response.statusCode).toBe(502);
      expect(response.json()).toMatchObject({ code });
    },
  );

  it('rejects secret-bearing provider URLs at the server boundary', async () => {
    const { runLogin } = makeHarness();
    const { app, token } = await fixture({
      runLogin,
      discoverFetch: vi.fn<typeof fetch>(),
    });
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/providers/custom',
      headers: { ...authedHeaders(token), 'content-type': 'application/json' },
      payload: {
        api: 'openai-completions',
        baseUrl: 'https://provider.example/v1?api_key=secret',
        envName: 'MOLTNET_PROVIDER_CUSTOM_API_KEY',
        models: [],
        apiKey: 'write-only-secret',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'invalid_provider' });
    expect(response.body).not.toContain('write-only-secret');
  });
});
