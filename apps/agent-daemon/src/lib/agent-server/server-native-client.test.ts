/**
 * Authorization of the native desktop client.
 *
 * The desktop app is granted process-scoped, not paired: the supervisor mints a
 * token and passes it in the child's environment, so no browser ceremony is
 * involved and the native origin must never be reachable through one.
 */
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { dirname, join } from 'node:path';

import { agentKeyKey } from '@themoltnet/sdk';
import { afterEach, describe, expect, it } from 'vitest';

import {
  publishAgentServerEndpoint,
  readAgentServerEndpoint,
} from './endpoint.js';
import { acquireAgentServerLock } from './lock.js';
import {
  NATIVE_CLIENT_ORIGIN,
  NativeGrantService,
} from './native-grant-service.js';
import type { OperatorOAuth } from './operator-oauth.js';
import { AGENT_SERVER_TOKEN_HEADER } from './server.js';
import {
  activateManaged,
  authorize,
  cleanupAll,
  fixture,
  HOST,
  TEST_CLIENT_ORIGIN,
} from './server-test-harness.js';

afterEach(cleanupAll);
const BROWSER_ORIGIN = 'https://console.themolt.net';

describe('native desktop client', () => {
  it('limits recovery to the native grant and restores a verified capture', async () => {
    const nativeGrant = new NativeGrantService();
    nativeGrant.grantNative('supervisor-token');
    const teamId = 'aaaaaaaa-0000-4000-8000-000000000001';
    const recoveryId = '4cb090aa-0c05-4166-9ae5-5a26d7c08193.json';
    const { app, store, secrets } = await fixture({
      nativeGrant,
      verifyCandidateTeamCredentialImpl: (_store, _alias, secret) => {
        if (secret !== 'captured-key')
          return Promise.reject(new Error('Candidate rejected'));
        return Promise.resolve({
          keyId: 'issued-key',
          scopes: [],
          verifiedAt: new Date().toISOString(),
        });
      },
    });
    activateManaged(store);
    const configDir = dirname(store.agentPath('course-bot'));
    const recoveryDir = join(configDir, 'credential-recovery');
    await mkdir(recoveryDir, { recursive: true });
    await writeFile(
      join(recoveryDir, recoveryId),
      JSON.stringify({
        version: 1,
        configDir,
        createdAt: new Date().toISOString(),
        retryContext: {
          provisioning: { teamId, operation: 'enroll', scopes: [] },
        },
        secretCaptured: true,
        subjectId: 'agent-1',
        teamId,
        keyId: 'issued-key',
        reference: { provider: 'file', key: agentKeyKey('agent-1', teamId) },
        secret: 'captured-key',
      }),
      { mode: 0o600 },
    );
    const url = `/v1/agents/course-bot/credential-recovery`;
    const headers = {
      host: HOST,
      origin: NATIVE_CLIENT_ORIGIN,
      [AGENT_SERVER_TOKEN_HEADER]: 'supervisor-token',
    };
    expect(
      (
        await app.inject({
          method: 'GET',
          url,
          headers: { ...headers, origin: BROWSER_ORIGIN },
        })
      ).statusCode,
    ).toBe(403);
    const listed = await app.inject({ method: 'GET', url, headers });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      items: [{ recoveryId, secretCaptured: true }],
    });
    const restored = await app.inject({
      method: 'POST',
      url: `${url}/${recoveryId}/restore`,
      headers,
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({
      state: 'persisted',
      teamId,
      keyId: 'issued-key',
    });
    expect(await secrets.read(agentKeyKey('agent-1', teamId))).toBe(
      'captured-key',
    );
    const repeat = await app.inject({
      method: 'POST',
      url: `${url}/${recoveryId}/restore`,
      headers,
    });
    expect(repeat.statusCode).toBe(404);
    const unreadableId = 'f56bdbe0-0c05-4166-9ae5-5a26d7c08193.json';
    await symlink(
      join(recoveryDir, recoveryId),
      join(recoveryDir, unreadableId),
    );
    const failed = await app.inject({
      method: 'POST',
      url: `${url}/${unreadableId}/restore`,
      headers,
    });
    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toMatchObject({ code: 'recovery_failed' });
    const incompleteId = 'a9fd6de4-15e4-4d20-a7d9-e908ec8ac13d.json';
    await writeFile(
      join(recoveryDir, incompleteId),
      JSON.stringify({
        version: 1,
        configDir,
        secretCaptured: false,
      }),
    );
    const incomplete = await app.inject({
      method: 'POST',
      url: `${url}/${incompleteId}/restore`,
      headers,
    });
    expect(incomplete.statusCode).toBe(409);
    expect(incomplete.json()).toMatchObject({ code: 'secret_not_captured' });
    const discardUrl = `${url}/${incompleteId}/discard`;
    const browserDiscard = await app.inject({
      method: 'POST',
      url: discardUrl,
      headers: {
        ...headers,
        origin: BROWSER_ORIGIN,
        'content-type': 'application/json',
      },
      payload: { expectedSecretCaptured: false },
    });
    expect(browserDiscard.statusCode, browserDiscard.body).toBe(403);
    const changed = await app.inject({
      method: 'POST',
      url: discardUrl,
      headers: { ...headers, 'content-type': 'application/json' },
      payload: { expectedSecretCaptured: true },
    });
    expect(changed.statusCode).toBe(409);
    const discarded = await app.inject({
      method: 'POST',
      url: discardUrl,
      headers: { ...headers, 'content-type': 'application/json' },
      payload: { expectedSecretCaptured: false },
    });
    expect(discarded.statusCode).toBe(200);
    expect(discarded.json()).toMatchObject({ state: 'discarded' });
    expect(
      (await app.inject({ method: 'GET', url, headers })).json(),
    ).toMatchObject({ items: [] });
  });
  it('returns operator team choices only to the native client', async () => {
    const nativeGrant = new NativeGrantService();
    nativeGrant.grantNative('supervisor-token');
    const teams = [
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000001',
        name: 'Research',
      },
    ];
    const { app } = await fixture({
      nativeGrant,
      operatorOAuth: {
        listTeams: () => teams,
        operatorConfigured: () => true,
        cancel: () => undefined,
      } as OperatorOAuth,
    });
    const headers = {
      host: HOST,
      origin: NATIVE_CLIENT_ORIGIN,
      [AGENT_SERVER_TOKEN_HEADER]: 'supervisor-token',
    };
    const allowed = await app.inject({
      method: 'GET',
      url: '/v1/operator/teams',
      headers,
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ items: teams });
    const denied = await app.inject({
      method: 'GET',
      url: '/v1/operator/teams',
      headers: { ...headers, origin: BROWSER_ORIGIN },
    });
    expect(denied.statusCode).toBe(403);
  });
  it('omits browser CORS headers from native-only errors even for configured browser origins', async () => {
    const { app } = await fixture({
      nativeOnly: true,
      allowedOrigins: [BROWSER_ORIGIN],
    });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/native/connection-settings',
      headers: { host: HOST, origin: BROWSER_ORIGIN },
    });
    expect(response.statusCode).toBe(403);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('runs two roots on separate endpoints while enforcing each singleton and native grant', async () => {
    const firstGrant = new NativeGrantService();
    const secondGrant = new NativeGrantService();
    firstGrant.grantNative('first-token');
    secondGrant.grantNative('second-token');
    const first = await fixture({ nativeGrant: firstGrant });
    const second = await fixture({ nativeGrant: secondGrant });
    const firstLock = await acquireAgentServerLock(first.store.root);
    const secondLock = await acquireAgentServerLock(second.store.root);
    try {
      await expect(
        acquireAgentServerLock(first.store.root),
      ).rejects.toMatchObject({ code: 'held' });
      const firstUrl = await first.app.listen({ host: '127.0.0.1', port: 0 });
      const secondUrl = await second.app.listen({ host: '127.0.0.1', port: 0 });
      expect(firstUrl).not.toBe(secondUrl);
      const firstRecord = publishAgentServerEndpoint(
        first.store.root,
        firstUrl,
      );
      const secondRecord = publishAgentServerEndpoint(
        second.store.root,
        secondUrl,
      );
      try {
        expect(readAgentServerEndpoint(first.store.root)?.url).toBe(firstUrl);
        expect(readAgentServerEndpoint(second.store.root)?.url).toBe(secondUrl);
        const headers = {
          origin: NATIVE_CLIENT_ORIGIN,
          [AGENT_SERVER_TOKEN_HEADER]: 'first-token',
        };
        for (const [url, expected] of [
          [firstUrl, 200],
          [secondUrl, 401],
        ] as const) {
          const status = await new Promise<number | undefined>(
            (resolve, reject) => {
              const req = request(
                `${url}/v1/native/connection-settings`,
                { headers },
                (response) => {
                  response.resume();
                  resolve(response.statusCode);
                },
              );
              req.on('error', reject);
              req.end();
            },
          );
          expect(status).toBe(expected);
        }
      } finally {
        firstRecord.release();
        secondRecord.release();
      }
    } finally {
      await firstLock.release();
      await secondLock.release();
    }
  });

  it('admits its actual loopback origin after binding an ephemeral port', async () => {
    const { app } = await fixture();
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: address },
    });
    expect(response.headers['access-control-allow-origin']).toBe(address);
  });

  it('starts native-only without configuring a browser origin', async () => {
    const nativeGrant = new NativeGrantService();
    nativeGrant.grantNative('supervisor-token');
    const { app } = await fixture({
      nativeGrant,
      nativeOnly: true,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/status',
      headers: {
        host: HOST,
        origin: NATIVE_CLIENT_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: 'supervisor-token',
      },
    });

    expect(response.statusCode).toBe(200);
  });
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
        origin: BROWSER_ORIGIN,
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

  it('separates authorized native requests from guesses and enforces their limit', async () => {
    const { app } = await fixture({ rateLimitMax: 1 });
    const token = await authorize(app);
    const request = (presented: string) =>
      app.inject({
        method: 'GET',
        url: '/v1/status',
        headers: {
          host: HOST,
          origin: TEST_CLIENT_ORIGIN,
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
        origin: BROWSER_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: 'supervisor-token',
      },
    });

    // Assert
    expect(response.statusCode).toBe(403);
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
