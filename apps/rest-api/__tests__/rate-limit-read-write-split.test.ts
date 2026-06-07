/**
 * Integration test for issue #1336 Part 2: authenticated GET reads draw from a
 * separate, more generous bucket (groupId 'read') than mutations, so a burst of
 * reads cannot starve writes.
 *
 * Drives the real @fastify/rate-limit plugin via app.inject. The mock token
 * validator resolves any bearer to a fixed identity, so all requests in a test
 * share one principal — the point is the read bucket vs the global (mutation)
 * bucket are independent for the SAME identity.
 */

import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  type MockServices,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const TOKEN = 'Bearer any-token';

async function read(app: FastifyInstance) {
  // GET /agents/whoami is in the 'read' group (config.rateLimit = read).
  return app.inject({
    method: 'GET',
    url: '/agents/whoami',
    headers: { authorization: TOKEN },
  });
}

async function mutate(app: FastifyInstance) {
  // POST /tasks has no per-route override → the global (mutation) bucket.
  return app.inject({
    method: 'POST',
    url: '/tasks',
    headers: { authorization: TOKEN, 'content-type': 'application/json' },
    payload: {},
  });
}

describe('Rate limiter read/write split (#1336 part 2)', () => {
  let mocks: MockServices;

  beforeEach(() => {
    mocks = createMockServices();
  });

  it('reports the read limit on read routes and the global limit on mutations', async () => {
    const app = await createTestApp(mocks, VALID_AUTH_CONTEXT, {
      rateLimitGlobalRead: 7,
      rateLimitGlobalAuth: 99,
    });

    const r = await read(app);
    expect(r.headers['x-ratelimit-limit']).toBe('7'); // read bucket

    const m = await mutate(app);
    // Whatever the handler returns, the limiter stamped the GLOBAL limit (99),
    // proving POST /tasks is on a different bucket than the read routes.
    expect(m.headers['x-ratelimit-limit']).toBe('99');

    await app.close();
  });

  it('exhausting the read bucket does NOT throttle mutations', async () => {
    const app = await createTestApp(mocks, VALID_AUTH_CONTEXT, {
      rateLimitGlobalRead: 3,
      rateLimitGlobalAuth: 99,
    });

    // Drain the read budget.
    expect((await read(app)).statusCode).toBe(200);
    expect((await read(app)).statusCode).toBe(200);
    expect((await read(app)).statusCode).toBe(200);
    expect((await read(app)).statusCode).toBe(429); // reads exhausted

    // The mutation bucket is untouched: POST /tasks is NOT rate-limited.
    // (It may fail for other reasons in the mock, but must not be a 429.)
    const m = await mutate(app);
    expect(m.statusCode).not.toBe(429);

    await app.close();
  });

  it('exhausting the mutation bucket does NOT throttle reads', async () => {
    const app = await createTestApp(mocks, VALID_AUTH_CONTEXT, {
      rateLimitGlobalRead: 99,
      rateLimitGlobalAuth: 3,
    });

    // Drain the global (mutation) budget with POSTs.
    for (let i = 0; i < 3; i++) {
      const m = await mutate(app);
      expect(m.statusCode).not.toBe(429);
    }
    expect((await mutate(app)).statusCode).toBe(429); // mutations exhausted

    // Reads remain available — separate bucket.
    expect((await read(app)).statusCode).toBe(200);

    await app.close();
  });
});
