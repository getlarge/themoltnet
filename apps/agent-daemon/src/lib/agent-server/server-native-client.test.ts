/**
 * Authorization of the native desktop client.
 *
 * The desktop app is granted process-scoped, not paired: the supervisor mints a
 * token and passes it in the child's environment, so no browser ceremony is
 * involved and the native origin must never be reachable through one.
 */
import { writeFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NATIVE_CLIENT_ORIGIN,
  NativeGrantService,
} from './native-grant-service.js';
import {
  InvalidOperatorGrantError,
  type OperatorOAuth,
} from './operator-oauth.js';
import { AGENT_SERVER_TOKEN_HEADER } from './server.js';
import {
  activateManaged,
  authorize,
  cleanupAll,
  CONSOLE_ORIGIN,
  fixture,
  HOST,
} from './server-test-harness.js';

afterEach(cleanupAll);

describe('native desktop client', () => {
  it('restricts connection settings to native administration and requires restart after saving', async () => {
    const nativeGrant = new NativeGrantService();
    nativeGrant.grantNative('settings-token');
    const { app } = await fixture({ nativeGrant });
    const token = await authorize(app);
    const denied = await app.inject({
      method: 'POST',
      url: '/v1/native/connection-settings',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
      },
      payload: {},
    });
    expect(denied.statusCode).toBe(403);
    const headers = {
      host: HOST,
      origin: NATIVE_CLIENT_ORIGIN,
      [AGENT_SERVER_TOKEN_HEADER]: 'settings-token',
    };
    const saved = await app.inject({
      method: 'POST',
      url: '/v1/native/connection-settings',
      headers,
      payload: { nativeClientId: 'another-native' },
    });
    expect(saved.statusCode).toBe(200);
    const blocked = await app.inject({
      method: 'GET',
      url: '/v1/status',
      headers,
    });
    expect(blocked.statusCode).toBe(409);
  });

  it('keeps active work running when a connection change is requested', async () => {
    const nativeGrant = new NativeGrantService();
    nativeGrant.grantNative('settings-token');
    const { app, store } = await fixture({ nativeGrant });
    activateManaged(store);
    const headers = {
      host: HOST,
      origin: NATIVE_CLIENT_ORIGIN,
      [AGENT_SERVER_TOKEN_HEADER]: 'settings-token',
    };
    const started = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers,
      payload: {
        agent: 'course-bot',
        teamId: 'team',
        profiles: ['profile'],
        taskTypes: ['freeform'],
        mode: 'poll',
      },
    });
    expect(started.statusCode).toBe(201);
    const refused = await app.inject({
      method: 'POST',
      url: '/v1/native/connection-settings',
      headers,
      payload: {},
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json<{ message: string }>().message).toContain(
      'Stop running or starting work',
    );
    const status = await app.inject({
      method: 'GET',
      url: '/v1/status',
      headers,
    });
    expect(status.statusCode).toBe(200);
    expect(status.json<unknown>()).toMatchObject({ runs: [{ active: true }] });
  });

  it('authorizes the native origin with the supervisor token', async () => {
    // Arrange
    const nativeGrant = new NativeGrantService();
    nativeGrant.grantNative('supervisor-token');
    const { app } = await fixture({ nativeGrant });

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/v1/status',
      headers: {
        host: HOST,
        origin: NATIVE_CLIENT_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: 'supervisor-token',
      },
    });

    // Assert
    expect(response.statusCode).toBe(200);
  });

  it.each([undefined, 'guessed'])(
    'rejects enrollment without the native grant (%s)',
    async (token) => {
      const nativeGrant = new NativeGrantService();
      nativeGrant.grantNative('supervisor-token');
      const { app } = await fixture({ nativeGrant });
      const response = await app.inject({
        method: 'POST',
        url: '/v1/agents/agent/teams',
        headers: {
          host: HOST,
          origin: NATIVE_CLIENT_ORIGIN,
          ...(token ? { [AGENT_SERVER_TOKEN_HEADER]: token } : {}),
        },
        payload: {
          mode: 'enroll',
          teamId: 'aaaaaaaa-0000-4000-8000-000000000001',
          idempotencyKey: 'request',
        },
      });
      expect(response.statusCode).toBe(401);
      expect(response.body).not.toContain('invite-sentinel');
    },
  );

  it('rejects the native origin with a wrong token', async () => {
    // Arrange
    const nativeGrant = new NativeGrantService();
    nativeGrant.grantNative('supervisor-token');
    const { app } = await fixture({ nativeGrant });

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/v1/status',
      headers: {
        host: HOST,
        origin: NATIVE_CLIENT_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: 'guessed',
      },
    });

    // Assert
    expect(response.statusCode).toBe(401);
  });

  it('does not let a guessed token exhaust the native client rate limit', async () => {
    // Arrange
    const nativeGrant = new NativeGrantService();
    nativeGrant.grantNative('supervisor-token');
    const { app } = await fixture({ nativeGrant, rateLimitMax: 1 });

    // Act: a local process spends the pre-auth budget with a non-empty guess.
    const guessed = await app.inject({
      method: 'GET',
      url: '/v1/status',
      headers: {
        host: HOST,
        origin: NATIVE_CLIENT_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: 'guessed',
      },
    });
    const authorized = await app.inject({
      method: 'GET',
      url: '/v1/status',
      headers: {
        host: HOST,
        origin: NATIVE_CLIENT_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: 'supervisor-token',
      },
    });

    // Assert: the valid desktop request has an independent budget.
    expect(guessed.statusCode).toBe(401);
    expect(authorized.statusCode).toBe(200);
  });

  it('separates authorized Console requests from guesses and enforces their limit', async () => {
    const { app } = await fixture({ rateLimitMax: 1 });
    const token = await authorize(app);
    const request = (presented: string) =>
      app.inject({
        method: 'GET',
        url: '/v1/status',
        headers: {
          host: HOST,
          origin: CONSOLE_ORIGIN,
          [AGENT_SERVER_TOKEN_HEADER]: presented,
        },
      });
    expect((await request('guessed')).statusCode).toBe(401);
    expect((await request(token)).statusCode).toBe(200);
    expect((await request('another-guess')).statusCode).toBe(429);
    expect((await request(token)).statusCode).toBe(429);
  });

  it('does not let a browser origin reuse the native token', async () => {
    // Arrange
    const nativeGrant = new NativeGrantService();
    nativeGrant.grantNative('supervisor-token');
    const { app } = await fixture({ nativeGrant });

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/v1/status',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: 'supervisor-token',
      },
    });

    // Assert
    expect(response.statusCode).toBe(401);
  });

  it('leaves the native origin unauthorized when no token was supplied', async () => {
    // Arrange: a server started without a supervisor grants nothing natively.
    const { app } = await fixture();

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/v1/status',
      headers: {
        host: HOST,
        origin: NATIVE_CLIENT_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: 'supervisor-token',
      },
    });

    // Assert
    expect(response.statusCode).toBe(401);
  });
});

describe('browser admission and stream authorization', () => {
  it('shares admission verification but revalidates before streaming log content', async () => {
    const verifyBrowser = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new InvalidOperatorGrantError('Grant expired'));
    const { app, store } = await fixture({
      operatorOAuth: {
        verifyBrowser,
        cancel: () => undefined,
      } as unknown as OperatorOAuth,
    });
    const { logPath } = store.createRunDir('expiring-run');
    store.writeRun({
      id: 'expiring-run',
      agent: 'agent',
      teamId: 'team',
      profiles: ['profile'],
      taskTypes: ['freeform'],
      mode: 'poll',
      status: 'exited',
      startedAt: '2026-01-01T00:00:00Z',
    });
    writeFileSync(logPath, 'must-not-be-forwarded\n');
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const result = fetch(`${address}/v1/runs/expiring-run/logs`, {
      headers: {
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: 'expiring-token',
      },
      signal: AbortSignal.timeout(3000),
    }).then((response) => response.text());
    await expect(result).rejects.toThrow();
    expect(verifyBrowser).toHaveBeenCalledTimes(2);
  });

  it('verifies a normal request once', async () => {
    const verifyBrowser = vi.fn().mockResolvedValue(undefined);
    const { app } = await fixture({
      operatorOAuth: {
        verifyBrowser,
        cancel: () => undefined,
      } as unknown as OperatorOAuth,
    });
    const response = await app.inject({
      url: '/v1/status',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: 'valid',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(verifyBrowser).toHaveBeenCalledTimes(1);
  });
});

it('distinguishes missing OAuth configuration from temporary verification failure', async () => {
  const missing = await fixture({ operatorOAuth: undefined });
  const unavailable = await fixture({
    operatorOAuth: {
      cancel: () => undefined,
      verifyBrowser: vi.fn().mockRejectedValue(new Error('JWKS unavailable')),
    } as unknown as OperatorOAuth,
  });
  for (const [app, expected] of [
    [missing.app, 'oauth_unavailable'],
    [unavailable.app, 'authorization_unavailable'],
  ] as const) {
    const response = await app.inject({
      url: '/v1/status',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: 'token',
      },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: expected });
  }
});
