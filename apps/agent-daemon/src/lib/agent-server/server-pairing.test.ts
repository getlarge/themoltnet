/**
 * The pairing ceremony over HTTP: a browser origin proves itself once and
 * receives an origin-bound token that every other `/v1` route then demands.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { PairingService } from './pairing.js';
import { AGENT_SERVER_TOKEN_HEADER } from './server.js';
import {
  cleanupAll,
  CONSOLE_ORIGIN,
  fixture,
  HOST,
  pair,
  writeCentralIdentity,
} from './server-test-harness.js';

afterEach(cleanupAll);

describe('agent server pairing', () => {
  it('invalidates grants when the supervisor process changes', () => {
    const firstProcess = new PairingService();
    const { pairingId } = firstProcess.start(CONSOLE_ORIGIN);
    const { confirmToken } = firstProcess.approval(pairingId);
    firstProcess.confirm(pairingId, confirmToken);
    const { token } = firstProcess.claim(pairingId, CONSOLE_ORIGIN);

    expect(() => firstProcess.verify(CONSOLE_ORIGIN, token)).not.toThrow();
    expect(() => new PairingService().verify(CONSOLE_ORIGIN, token)).toThrow(
      'not valid for this origin',
    );
  });

  it('completes the one-click ceremony and gates /v1 on the token', async () => {
    const { app } = await fixture();

    const unpaired = await app.inject({
      method: 'GET',
      url: '/v1/status',
      headers: { host: HOST, origin: CONSOLE_ORIGIN },
    });
    expect(unpaired.statusCode).toBe(401);

    const token = await pair(app);
    const status = await app.inject({
      method: 'GET',
      url: '/v1/status',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
      },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      version: 'test',
      runtimeSettings: {
        heartbeatIntervalMs: 60_000,
        warmRetentionSec: 1800,
      },
      runs: [],
    });

    const wrongToken = await app.inject({
      method: 'GET',
      url: '/v1/status',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: 'forged',
      },
    });
    expect(wrongToken.statusCode).toBe(401);
  });

  it('reports central identities and the environment-selected identity', async () => {
    const { app, store } = await fixture({ activeIdentity: 'second' });
    writeCentralIdentity(store, 'first', true);
    writeCentralIdentity(store, 'second', false);
    const token = await pair(app);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/status',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      selectedIdentity: 'second',
      identities: [
        { alias: 'first', activated: false, hasAgentKey: true },
        { alias: 'second', activated: false, hasAgentKey: false },
      ],
    });
  });

  it('rate-limits the loopback HTTP surface with stable errors', async () => {
    const { app } = await fixture({ rateLimitMax: 1 });
    const headers = {
      host: HOST,
      origin: CONSOLE_ORIGIN,
    };

    const allowed = await app.inject({
      method: 'POST',
      url: '/v1/pairings',
      headers,
    });
    const limited = await app.inject({
      method: 'POST',
      url: '/v1/pairings',
      headers,
    });

    expect(allowed.statusCode).toBe(201);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({
      code: 'rate_limited',
      message: 'Too many requests',
    });
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('rejects claims from a different origin and cross-site confirms', async () => {
    const { app } = await fixture();
    const started = await app.inject({
      method: 'POST',
      url: '/v1/pairings',
      headers: { host: HOST, origin: CONSOLE_ORIGIN },
    });
    const { pairingId } = started.json<{ pairingId: string }>();

    const crossSite = await app.inject({
      method: 'POST',
      url: `/pairings/${pairingId}/confirm`,
      headers: {
        host: HOST,
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-site': 'cross-site',
      },
      payload: 'confirmToken=x',
    });
    expect(crossSite.statusCode).toBe(400);

    const foreignClaim = await app.inject({
      method: 'POST',
      url: `/v1/pairings/${pairingId}/claim`,
      headers: { host: HOST, origin: 'http://127.0.0.1:17374' },
    });
    expect([401, 403]).toContain(foreignClaim.statusCode);
  });
});
