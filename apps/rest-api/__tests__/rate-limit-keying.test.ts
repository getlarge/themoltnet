/**
 * Integration regression test for issue #1336: the rate limiter must bucket by
 * the VERIFIED principal (identityId), not by IP and not per-token.
 *
 * Before the fix the limiter ran at `onRequest` before the auth preHandler set
 * request.authContext, so keyGenerator always fell through to request.ip —
 * collapsing every authenticated principal behind a shared IP onto ONE bucket
 * and onto the stricter anonymous limit. The fix resolves authContext in a
 * global `onRequest` hook (registered before the limiter), so the limiter sees
 * the verified identityId.
 *
 * These tests drive the real @fastify/rate-limit plugin and the real auth
 * onRequest hook via app.inject (all inject requests share request.ip), with low
 * limits. The mock token validator maps each token to an identity, so we can
 * exercise per-identity isolation AND multi-token coalescing.
 *
 * NOTE: `hit()` targets GET /agents/whoami, which (since #1336 part 2) is in the
 * 'read' group — so these tests set `rateLimitGlobalRead` as the budget under
 * test. Identity keying works identically for the read bucket. A per-route
 * `config.rateLimit.max` is a fixed number, so the read bucket applies the same
 * limit to authed and anon requests alike (anon requests are 401'd by
 * requireAuth anyway); the anon-vs-auth dynamic limit is exercised on a global-
 * bucket route below.
 */

import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  type MockServices,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

/** A bearer token string; its value is mapped to an identity by the resolver. */
function tokenFor(label: string): string {
  return `token-${label}`;
}

/**
 * Per-token resolver: a token named `token-<identity>#<n>` resolves to identity
 * `<identity>`. Lets one identity present multiple distinct tokens.
 */
function resolverByTokenLabel(token: string) {
  const m = /^token-([^#]+)(?:#.*)?$/.exec(token);
  if (!m) return null;
  return { ...VALID_AUTH_CONTEXT, identityId: m[1] };
}

async function hit(app: FastifyInstance, token: string) {
  return app.inject({
    method: 'GET',
    url: '/agents/whoami',
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('Rate limiter keys by verified identity (#1336)', () => {
  let mocks: MockServices;

  beforeEach(() => {
    mocks = createMockServices();
  });

  it('gives two distinct identities on the same IP separate budgets', async () => {
    const app = await createTestApp(
      mocks,
      VALID_AUTH_CONTEXT,
      { rateLimitGlobalRead: 2 },
      undefined,
      resolverByTokenLabel,
    );

    // Identity A exhausts its budget (2 allowed, 3rd 429).
    expect((await hit(app, tokenFor('agent-a'))).statusCode).toBe(200);
    expect((await hit(app, tokenFor('agent-a'))).statusCode).toBe(200);
    expect((await hit(app, tokenFor('agent-a'))).statusCode).toBe(429);

    // Identity B — same IP — has its own full budget.
    expect((await hit(app, tokenFor('agent-b'))).statusCode).toBe(200);
    expect((await hit(app, tokenFor('agent-b'))).statusCode).toBe(200);
    expect((await hit(app, tokenFor('agent-b'))).statusCode).toBe(429);

    await app.close();
  });

  it('shares ONE budget across multiple tokens of the same identity (coalescing)', async () => {
    // The core requirement: an agent holding several JWT/session tokens must not
    // get N budgets. Two different token strings resolve to the same identity.
    const app = await createTestApp(
      mocks,
      VALID_AUTH_CONTEXT,
      { rateLimitGlobalRead: 2 },
      undefined,
      resolverByTokenLabel,
    );

    const token1 = 'token-same-agent#1';
    const token2 = 'token-same-agent#2'; // different bytes, same identity

    expect((await hit(app, token1)).statusCode).toBe(200);
    expect((await hit(app, token2)).statusCode).toBe(200);
    // Budget of 2 is now spent across the two tokens — the third request from
    // EITHER token is throttled, proving they share a single identity bucket.
    expect((await hit(app, token1)).statusCode).toBe(429);
    expect((await hit(app, token2)).statusCode).toBe(429);

    await app.close();
  });

  it('applies the read limit to a verified identity on a read route', async () => {
    const app = await createTestApp(
      mocks,
      VALID_AUTH_CONTEXT,
      { rateLimitGlobalRead: 3 },
      undefined,
      resolverByTokenLabel,
    );

    const token = tokenFor('agent-authed');
    expect((await hit(app, token)).statusCode).toBe(200);
    expect((await hit(app, token)).statusCode).toBe(200);
    expect((await hit(app, token)).statusCode).toBe(200);
    expect((await hit(app, token)).statusCode).toBe(429);

    const limited = await hit(app, token);
    expect(limited.headers['x-ratelimit-limit']).toBe('3');

    await app.close();
  });

  it('applies auth vs anon limit dynamically on a global-bucket (mutation) route', async () => {
    // POST /tasks is on the global bucket, whose `max` is the dynamic auth/anon
    // function. An authenticated identity gets the auth limit...
    const app = await createTestApp(
      mocks,
      VALID_AUTH_CONTEXT,
      { rateLimitGlobalAuth: 7, rateLimitGlobalAnon: 4 },
      undefined,
      resolverByTokenLabel,
    );

    const authed = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: {
        authorization: `Bearer ${tokenFor('agent-authed')}`,
        'content-type': 'application/json',
      },
      payload: {},
    });
    expect(authed.headers['x-ratelimit-limit']).toBe('7'); // auth limit

    // ...and an unauthenticated request was keyed anon at onRequest (it is then
    // rejected downstream — 400/401 depending on body validation order — but the
    // rate-limit header already reflects the anon limit).
    const anon = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(anon.statusCode).not.toBe(200);
    expect(anon.headers['x-ratelimit-limit']).toBe('4'); // anon limit

    await app.close();
  });

  it('pre-resolve IP throttle blocks spray BEFORE auth resolution (CodeQL #57)', async () => {
    // The anti-amplification guard: a single IP spraying credentialed requests
    // must be throttled BEFORE populateAuthContext does its (network) auth
    // resolution, so it cannot amplify load onto Hydra/Kratos.
    let resolveCalls = 0;
    const countingResolver = (token: string) => {
      resolveCalls += 1;
      return resolverByTokenLabel(token);
    };

    const app = await createTestApp(
      mocks,
      VALID_AUTH_CONTEXT,
      // High identity limits so ONLY the pre-resolve IP ceiling (2) can trip.
      { rateLimitGlobalAuth: 1000, rateLimitPreResolveIp: 2 },
      undefined,
      countingResolver,
    );

    // Two opaque-ish tokens go through (each resolves once), the third is
    // throttled at the IP gate before resolution.
    expect((await hit(app, 'token-agent-x#1')).statusCode).toBe(200);
    expect((await hit(app, 'token-agent-x#2')).statusCode).toBe(200);
    const blocked = await hit(app, 'token-agent-x#3');
    expect(blocked.statusCode).toBe(429);

    // Crucially, the blocked request did NOT trigger auth resolution.
    expect(resolveCalls).toBe(2);

    await app.close();
  });
});
