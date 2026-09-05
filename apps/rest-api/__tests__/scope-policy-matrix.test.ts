import type { CredentialScope } from '@moltnet/auth';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  DIARY_ID,
  OWNER_ID,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

/**
 * One probe per scope family declared by at least one route.
 *
 * Write families are reached either through a body-less DELETE or with the
 * smallest schema-valid `body` the route accepts.
 *
 * `connector:invoke` and `human:profile` are in the vocabulary but declared by
 * no route — connector issuance was never built, and `human:profile` is carried
 * only by human sessions.
 */
interface ScopeProbe {
  family: string;
  request: Pick<InjectOptions, 'method' | 'url'>;
  scope: CredentialScope;
  teamBound?: boolean;
  /**
   * Minimal schema-valid payload. Fastify validates the body before the
   * preHandler chain, so a write probe without one would assert schema
   * validation rather than the scope gate.
   */
  body?: Record<string, unknown>;
}

const PROBES: readonly ScopeProbe[] = [
  {
    family: 'agent profile',
    request: { method: 'GET', url: '/agents/whoami' },
    scope: 'agent:profile',
  },
  {
    family: 'cryptographic signing',
    request: { method: 'GET', url: '/crypto/signing-requests' },
    scope: 'crypto:sign',
  },
  {
    family: 'diary',
    request: { method: 'GET', url: `/diaries/${DIARY_ID}/entries` },
    scope: 'diary:read',
    teamBound: true,
  },
  {
    family: 'agent key',
    request: { method: 'GET', url: '/agent-keys' },
    scope: 'key:manage',
    teamBound: true,
  },
  {
    family: 'context pack',
    request: {
      method: 'GET',
      url: `/packs/${DIARY_ID}/provenance`,
    },
    scope: 'pack:read',
    teamBound: true,
  },
  {
    family: 'runtime configuration',
    request: { method: 'GET', url: '/runtime-models' },
    scope: 'runtime:read',
    teamBound: true,
  },
  {
    family: 'task',
    request: { method: 'GET', url: '/tasks/schemas' },
    scope: 'task:read',
  },
  {
    family: 'task execution',
    request: { method: 'GET', url: '/runtime-slots' },
    scope: 'task:execute',
    teamBound: true,
  },
  {
    family: 'team',
    request: { method: 'GET', url: '/teams' },
    scope: 'team:read',
    teamBound: true,
  },
  {
    family: 'diary management',
    request: { method: 'DELETE', url: `/diaries/${DIARY_ID}` },
    scope: 'diary:manage',
    teamBound: true,
  },
  {
    family: 'diary write',
    request: { method: 'DELETE', url: `/relations/${DIARY_ID}` },
    scope: 'diary:write',
    teamBound: true,
  },
  {
    family: 'runtime management',
    request: { method: 'DELETE', url: `/runtime-models/${DIARY_ID}` },
    scope: 'runtime:manage',
    teamBound: true,
  },
  {
    family: 'task claim',
    request: { method: 'POST', url: `/tasks/${DIARY_ID}/claim` },
    scope: 'task:claim',
    teamBound: true,
    body: { leaseTtlSec: 60 },
  },
  {
    family: 'pack write',
    request: { method: 'PATCH', url: `/packs/${DIARY_ID}` },
    scope: 'pack:write',
    teamBound: true,
    body: { pinned: true },
  },
];

/** Scope-denial detail, or '' when the response carries no JSON body. */
function scopeDenialDetail(response: { json: () => unknown }): string {
  try {
    return (response.json() as { detail?: string }).detail ?? '';
  } catch {
    return '';
  }
}

describe('credential scope policy matrix', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp(
      createMockServices(),
      null,
      undefined,
      undefined,
      (token) => ({
        ...VALID_AUTH_CONTEXT,
        scopes: token === 'no-scopes' ? [] : [token as CredentialScope],
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(PROBES)(
    'allows a minimally scoped credential through the $family scope gate',
    async ({ request, scope, teamBound, body }) => {
      const response = await app.inject({
        ...request,
        ...(body ? { body } : {}),
        headers: {
          authorization: `Bearer ${scope}`,
          ...(teamBound ? { 'x-moltnet-team-id': OWNER_ID } : {}),
        },
      });

      // Assert no scope denial at all, not merely none naming `scope`: a
      // route that later declares a second required scope would 403 naming
      // that other one, and a `${scope}`-specific assertion would still pass,
      // silently retiring the minimality guarantee this probe exists for.
      // A plain `statusCode !== 403` is too strong — team-bound probes are
      // legitimately Keto-denied by the mocks, which is not a scope failure.
      expect(scopeDenialDetail(response)).not.toMatch(
        /^Missing required scope:/,
      );
    },
  );

  it('keeps agent-key revocation reachable without any credential scope', async () => {
    // POST /agent-keys/:keyId/revoke is the only production route declaring
    // `requiredScopes: []`. It is a deliberate self-revocation escape hatch: a
    // narrowly scoped or compromised key must always be killable by its holder,
    // with Keto still deciding *which* key. Adding `key:manage` here — as its
    // three siblings have — would make a five-scope daemon key unrevokable by
    // its own holder, a security regression with every other test still green.
    const response = await app.inject({
      method: 'POST',
      url: `/agent-keys/${DIARY_ID}/revoke`,
      headers: { authorization: 'Bearer task:execute' },
      body: { reason: 'key_compromise' },
    });

    expect(response.statusCode).not.toBe(403);
    expect(response.json()).not.toMatchObject({
      detail: expect.stringMatching(/^Missing required scope:/),
    });
  });

  it.each(PROBES)(
    'rejects a credential holding only an unrelated scope on the $family gate',
    async ({ request, scope, teamBound, body }) => {
      // The strongest regression guard: a credential that carries a real scope,
      // just not this route's. Proves the gate is per-scope rather than
      // "authenticated and holding something".
      const unrelated: CredentialScope =
        scope === 'team:read' ? 'agent:profile' : 'team:read';
      const response = await app.inject({
        ...request,
        ...(body ? { body } : {}),
        headers: {
          authorization: `Bearer ${unrelated}`,
          ...(teamBound ? { 'x-moltnet-team-id': OWNER_ID } : {}),
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        detail: `Missing required scope: ${scope}`,
      });
    },
  );

  it.each(PROBES)(
    'rejects a credential without the $family scope',
    async ({ request, scope, teamBound, body }) => {
      const response = await app.inject({
        ...request,
        ...(body ? { body } : {}),
        headers: {
          authorization: 'Bearer no-scopes',
          ...(teamBound ? { 'x-moltnet-team-id': OWNER_ID } : {}),
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        detail: `Missing required scope: ${scope}`,
      });
    },
  );
});
