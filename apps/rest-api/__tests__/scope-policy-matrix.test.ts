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
 * One read-only probe per scope family. Write scopes (`diary:write`,
 * `pack:write`, `task:claim`, `task:manage`, `runtime:manage`, `diary:manage`,
 * `team:manage`) are deliberately absent: Fastify validates the body before the
 * preHandler chain, so probing them here would assert schema validation rather
 * than the scope gate. Those families are covered by their own route suites.
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
];

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
    async ({ request, scope, teamBound }) => {
      const response = await app.inject({
        ...request,
        headers: {
          authorization: `Bearer ${scope}`,
          ...(teamBound ? { 'x-moltnet-team-id': OWNER_ID } : {}),
        },
      });

      expect(response.json()).not.toMatchObject({
        detail: `Missing required scope: ${scope}`,
      });
    },
  );

  it.each(PROBES)(
    'rejects a credential holding only an unrelated scope on the $family gate',
    async ({ request, scope, teamBound }) => {
      // The strongest regression guard: a credential that carries a real scope,
      // just not this route's. Proves the gate is per-scope rather than
      // "authenticated and holding something".
      const unrelated: CredentialScope =
        scope === 'team:read' ? 'agent:profile' : 'team:read';
      const response = await app.inject({
        ...request,
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
    async ({ request, scope, teamBound }) => {
      const response = await app.inject({
        ...request,
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
