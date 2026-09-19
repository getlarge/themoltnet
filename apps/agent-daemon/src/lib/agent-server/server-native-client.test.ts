/**
 * Authorization of the native desktop client.
 *
 * The desktop app is granted process-scoped, not paired: the supervisor mints a
 * token and passes it in the child's environment, so no browser ceremony is
 * involved and the native origin must never be reachable through one.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  NATIVE_CLIENT_ORIGIN,
  NativeGrantService,
} from './native-grant-service.js';
import {
  cleanupAll,
  CONSOLE_ORIGIN,
  fixture,
  HOST,
} from './server-test-harness.js';
import { AGENT_SERVER_TOKEN_HEADER } from './server.js';

afterEach(cleanupAll);

describe('native desktop client', () => {
  it('authorizes the native origin with the supervisor token', async () => {
    // Arrange
    const pairing = new NativeGrantService();
    pairing.grantNative('supervisor-token');
    const { app } = await fixture({ pairing });

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
      const pairing = new NativeGrantService();
      pairing.grantNative('supervisor-token');
      const { app } = await fixture({ pairing });
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
    const pairing = new NativeGrantService();
    pairing.grantNative('supervisor-token');
    const { app } = await fixture({ pairing });

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
    const pairing = new NativeGrantService();
    pairing.grantNative('supervisor-token');
    const { app } = await fixture({ pairing, rateLimitMax: 1 });

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

  it('does not let a browser origin reuse the native token', async () => {
    // Arrange
    const pairing = new NativeGrantService();
    pairing.grantNative('supervisor-token');
    const { app } = await fixture({ pairing });

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

  it('refuses to open a browser pairing for the native origin', async () => {
    // A page that could pair as the native client would inherit desktop
    // authority, so the ceremony must refuse that origin outright.
    const { app } = await fixture();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/pairings',
      headers: { host: HOST, origin: NATIVE_CLIENT_ORIGIN },
    });

    // `pairing_invalid` is forbidden, not malformed — the existing mapping.
    expect(response.statusCode).toBe(410);
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
