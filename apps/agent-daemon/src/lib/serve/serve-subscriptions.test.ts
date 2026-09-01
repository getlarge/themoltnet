/**
 * Subscription OAuth brokering tests (#2061 slice 4): the login flow runs
 * against an injected fake runner — no real provider traffic — and the
 * HTTP surface is exercised end to end through the paired serve server.
 */
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileSecretProvider } from '@themoltnet/sdk/node';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

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
}): Promise<{ app: FastifyInstance; token: string }> {
  const temp = mkdtempSync(join(tmpdir(), 'serve-subs-'));
  const store = new ServeStore(join(temp, 'moltnet')).ensure();
  const secrets = new FileSecretProvider({
    root: store.secretsDir,
    writable: true,
  });
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
    secrets,
    baseEnv: {},
    entrypoint: { execPath: '/bin/node', execArgv: [], scriptPath: '/m.js' },
    spawnImpl: (() =>
      new EventEmitter() as unknown as ChildProcess) as SpawnImpl,
  });
  const app = buildServeServer({
    store,
    secrets,
    pairing: new PairingService(store),
    runs,
    subscriptions,
    allowedOrigins: [CONSOLE_ORIGIN],
    defaultApiUrl: 'https://api.example',
    version: 'test',
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

describe('serve subscriptions', () => {
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
      error: 'access_denied',
    });
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
});
