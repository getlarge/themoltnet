/**
 * Integration regression test for issue #1336: the rate limiter must bucket by
 * identity, not by IP. Before the fix, the limiter ran at `onRequest` (before
 * the auth preHandler set request.authContext), so keyGenerator always fell
 * through to request.ip — collapsing every authenticated principal behind a
 * shared IP onto ONE bucket and onto the stricter anonymous limit.
 *
 * These tests drive the real @fastify/rate-limit plugin via app.inject (all
 * inject requests share request.ip = 127.0.0.1), with low limits, and assert:
 *   1. Two distinct bearer identities on the same IP get SEPARATE budgets.
 *   2. An authenticated principal gets the authenticated limit, not the anon one.
 *
 * The keying is driven by the JWT in the Authorization header (decoded by the
 * limiter's key extractor), independent of the mocked token validator that
 * satisfies the downstream auth preHandler.
 */

import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  type MockServices,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

/** A decodable (unsigned) JWT carrying a moltnet:identity_id claim. */
function jwtFor(identityId: string): string {
  const b64 = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = b64({ alg: 'RS256', typ: 'JWT' });
  const payload = b64({ 'moltnet:identity_id': identityId, sub: 'client' });
  return `${header}.${payload}.sig`;
}

async function hit(app: FastifyInstance, token: string) {
  return app.inject({
    method: 'GET',
    url: '/agents/whoami',
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('Rate limiter keys by identity, not IP (#1336)', () => {
  let mocks: MockServices;

  beforeEach(() => {
    mocks = createMockServices();
  });

  it('gives two identities on the same IP separate budgets', async () => {
    // Auth limit of 2/min. All inject requests share IP 127.0.0.1, so if the
    // limiter still keyed by IP, identity B would inherit A's exhausted bucket.
    const app = await createTestApp(mocks, VALID_AUTH_CONTEXT, {
      rateLimitGlobalAuth: 2,
      rateLimitGlobalAnon: 2,
    });

    const tokenA = jwtFor('agent-aaaa');
    const tokenB = jwtFor('agent-bbbb');

    // Exhaust identity A's budget (2 allowed, 3rd is 429).
    expect((await hit(app, tokenA)).statusCode).toBe(200);
    expect((await hit(app, tokenA)).statusCode).toBe(200);
    expect((await hit(app, tokenA)).statusCode).toBe(429);

    // Identity B — same IP — must still have a full, independent budget.
    expect((await hit(app, tokenB)).statusCode).toBe(200);
    expect((await hit(app, tokenB)).statusCode).toBe(200);
    expect((await hit(app, tokenB)).statusCode).toBe(429);

    await app.close();
  });

  it('applies the authenticated limit (not the anon limit) to a bearer identity', async () => {
    // Anon limit 1, auth limit 3. An authenticated identity must get 3, proving
    // max() consults the derived identity, not the (still-null at onRequest)
    // authContext that previously forced everyone onto the anon limit.
    const app = await createTestApp(mocks, VALID_AUTH_CONTEXT, {
      rateLimitGlobalAuth: 3,
      rateLimitGlobalAnon: 1,
    });

    const token = jwtFor('agent-authed');
    expect((await hit(app, token)).statusCode).toBe(200);
    expect((await hit(app, token)).statusCode).toBe(200);
    expect((await hit(app, token)).statusCode).toBe(200);
    expect((await hit(app, token)).statusCode).toBe(429);

    // The authenticated limit header reflects the auth limit, not the anon one.
    const limited = await hit(app, token);
    expect(limited.headers['x-ratelimit-limit']).toBe('3');

    await app.close();
  });
});
