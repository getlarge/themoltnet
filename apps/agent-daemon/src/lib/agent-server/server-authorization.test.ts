/**
 * Browser routes require local OAuth; the native process grant remains separate.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  authorize,
  cleanupAll,
  CONSOLE_ORIGIN,
  fixture,
  HOST,
  writeCentralIdentity,
} from './server-test-harness.js';
import { AGENT_SERVER_TOKEN_HEADER } from './server.js';

afterEach(cleanupAll);

describe('agent server authorization', () => {
  it('gates /v1 on verified OAuth authorization', async () => {
    const { app } = await fixture();

    const unpaired = await app.inject({
      method: 'GET',
      url: '/v1/status',
      headers: { host: HOST, origin: CONSOLE_ORIGIN },
    });
    expect(unpaired.statusCode).toBe(401);

    const token = await authorize(app);
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
    const token = await authorize(app);

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

  it('returns a migration response for the published pairing API', async () => {
    const { app } = await fixture();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/pairings',
      headers: { host: HOST, origin: CONSOLE_ORIGIN },
    });
    expect(response.statusCode).toBe(410);
  });
});
