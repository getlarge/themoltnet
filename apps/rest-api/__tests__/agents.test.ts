import type { AuthContext } from '@moltnet/auth';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createMockAgent,
  createMockServices,
  createTestApp,
  HUMAN_AUTH_CONTEXT,
  KEY_AUTH_CONTEXT,
  type MockServices,
  OTHER_AGENT_ID,
  OWNER_ID,
  OWNER_IDENTITY_ID,
  resetMockServices,
  TEST_BEARER_TOKEN,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const authHeaders = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };

describe('Agent routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeAll(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetMockServices(mocks);
  });

  describe('GET /agents/:fingerprint', () => {
    it('returns agent profile', async () => {
      mocks.agentRepository.findByFingerprint.mockResolvedValue(
        createMockAgent({ alias: 'Public.Must.Not.Leak' }),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/agents/C212-DAFA-27C5-6C57',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.publicKey).toBe(
        'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=',
      );
      expect(body.fingerprint).toBe('C212-DAFA-27C5-6C57');
      expect(body).not.toHaveProperty('alias');
    });

    it('returns 404 when agent not found', async () => {
      mocks.agentRepository.findByFingerprint.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/agents/AAAA-BBBB-CCCC-DDDD',
      });

      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain('application/json');
      const body = response.json();
      expect(body.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /agents/:fingerprint/verify', () => {
    it('verifies valid signature', async () => {
      mocks.agentRepository.findByFingerprint.mockResolvedValue(
        createMockAgent(),
      );
      mocks.signingRequestRepository.findBySignature.mockResolvedValue({
        id: 'sr-1',
        // `signing_requests.agent_id` stores a Kratos identity, not agents.id:
        // the column carries no foreign key, so migration 0041's FK-driven
        // rewrite never reached it. Retargeting it needs its own migration.
        agentId: OWNER_IDENTITY_ID,
        message: 'test message',
        nonce: 'nonce-1',
      } as any);
      mocks.cryptoService.verifyWithNonce.mockResolvedValue(true);

      const response = await app.inject({
        method: 'POST',
        url: '/agents/C212-DAFA-27C5-6C57/verify',
        payload: {
          signature: 'valid_sig',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.valid).toBe(true);
      expect(body.signer.fingerprint).toBe('C212-DAFA-27C5-6C57');
      expect(
        mocks.signingRequestRepository.findBySignature,
      ).toHaveBeenCalledWith('valid_sig');
    });

    it('returns invalid for bad signature', async () => {
      mocks.agentRepository.findByFingerprint.mockResolvedValue(
        createMockAgent(),
      );
      mocks.signingRequestRepository.findBySignature.mockResolvedValue({
        id: 'sr-1',
        agentId: OWNER_ID,
        message: 'test message',
        nonce: 'nonce-1',
      } as any);
      mocks.cryptoService.verifyWithNonce.mockResolvedValue(false);

      const response = await app.inject({
        method: 'POST',
        url: '/agents/C212-DAFA-27C5-6C57/verify',
        payload: {
          signature: 'bad_sig',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().valid).toBe(false);
      expect(
        mocks.signingRequestRepository.findBySignature,
      ).toHaveBeenCalledWith('bad_sig');
    });

    it('returns invalid when signature belongs to another agent', async () => {
      mocks.agentRepository.findByFingerprint.mockResolvedValue(
        createMockAgent(),
      );
      mocks.signingRequestRepository.findBySignature.mockResolvedValue({
        id: 'sr-2',
        agentId: OTHER_AGENT_ID,
        message: 'test message',
        nonce: 'nonce-2',
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: '/agents/C212-DAFA-27C5-6C57/verify',
        payload: {
          signature: 'sig',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().valid).toBe(false);
      expect(mocks.cryptoService.verifyWithNonce).not.toHaveBeenCalled();
    });

    it('returns 404 when agent not found', async () => {
      mocks.agentRepository.findByFingerprint.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/agents/AAAA-BBBB-CCCC-DDDD/verify',
        payload: {
          signature: 'sig',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain('application/json');
      const body = response.json();
      expect(body.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /agents/whoami', () => {
    it('returns current agent identity with subjectType and currentTeamId', async () => {
      mocks.agentRepository.findById.mockResolvedValue(
        createMockAgent({ alias: 'Build.Agent' }),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/agents/whoami',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      // subjectId is agents.id — the durable one. identityId is the Kratos
      // binding this request authenticated as.
      expect(body.subjectId).toBe(OWNER_ID);
      expect(body.identityId).toBe(OWNER_IDENTITY_ID);
      expect(body.fingerprint).toBe('C212-DAFA-27C5-6C57');
      expect(body.alias).toBe('Build.Agent');
      expect(body.subjectType).toBe('agent');
      expect(body.scopes).toEqual(VALID_AUTH_CONTEXT.scopes);
      expect(body).toHaveProperty('currentTeamId');
      expect(body).not.toHaveProperty('credentialBinding');
    });

    it('includes credentialBinding when authenticated via an agent key', async () => {
      const keyApp = await createTestApp(mocks, KEY_AUTH_CONTEXT);
      mocks.agentRepository.findById.mockResolvedValue(createMockAgent());

      const response = await keyApp.inject({
        method: 'GET',
        url: '/agents/whoami',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().credentialBinding).toEqual({
        bindingScope: 'team',
        keyId: 'key-123',
        boundTeamId: OWNER_ID,
      });
      await keyApp.close();
    });

    it('returns the identity discriminator without a boundTeamId', async () => {
      const keyApp = await createTestApp(mocks, {
        ...KEY_AUTH_CONTEXT,
        credentialBinding: {
          bindingScope: 'identity',
          keyId: 'identity-key-123',
        },
      });
      mocks.agentRepository.findById.mockResolvedValue(createMockAgent());

      const response = await keyApp.inject({
        method: 'GET',
        url: '/agents/whoami',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().credentialBinding).toEqual({
        bindingScope: 'identity',
        keyId: 'identity-key-123',
      });
      await keyApp.close();
    });

    it('returns a human identity without a 403', async () => {
      const humanApp = await createTestApp(mocks, HUMAN_AUTH_CONTEXT);

      const response = await humanApp.inject({
        method: 'GET',
        url: '/agents/whoami',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      // subjectId is humans.id (the FK target and Keto subject);
      // identityId is the Kratos binding. Distinct values on purpose.
      expect(body.subjectId).toBe(OWNER_ID);
      expect(body.identityId).toBe(OWNER_IDENTITY_ID);
      expect(body.subjectType).toBe('human');
      expect(body.scopes).toEqual(HUMAN_AUTH_CONTEXT.scopes);
      expect(body).not.toHaveProperty('publicKey');
      await humanApp.close();
    });

    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/agents/whoami',
      });

      expect(response.statusCode).toBe(401);
      expect(response.headers['content-type']).toContain('application/json');
      const body = response.json();
      expect(body.code).toBe('UNAUTHORIZED');
    });
  });

  describe('PATCH /agents/whoami', () => {
    it('publishes a case-preserving alias for only the authenticated agent', async () => {
      mocks.agentRepository.updateAlias.mockResolvedValue(
        createMockAgent({ alias: 'Build.Agent' }),
      );

      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/whoami',
        headers: authHeaders,
        payload: { alias: 'Build.Agent' },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.agentRepository.updateAlias).toHaveBeenCalledWith(
        OWNER_ID,
        'Build.Agent',
      );
      expect(response.json()).toEqual({
        subjectId: OWNER_ID,
        fingerprint: 'C212-DAFA-27C5-6C57',
        alias: 'Build.Agent',
      });
    });

    it('accepts the 63-character boundary and reports the stored value', async () => {
      const alias = 'a'.repeat(63);
      mocks.agentRepository.updateAlias.mockResolvedValue(
        createMockAgent({ alias }),
      );

      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/whoami',
        headers: authHeaders,
        payload: { alias },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().alias).toBe(alias);
    });

    it.each(['-starts-wrong', 'contains space', '', 'a'.repeat(64), 'ünïcode'])(
      'rejects invalid alias %j',
      async (alias) => {
        const response = await app.inject({
          method: 'PATCH',
          url: '/agents/whoami',
          headers: authHeaders,
          payload: { alias },
        });

        expect(response.statusCode).toBe(400);
        expect(mocks.agentRepository.updateAlias).not.toHaveBeenCalled();
      },
    );

    it('rejects human callers', async () => {
      const humanApp = await createTestApp(mocks, HUMAN_AUTH_CONTEXT);
      try {
        const response = await humanApp.inject({
          method: 'PATCH',
          url: '/agents/whoami',
          headers: authHeaders,
          payload: { alias: 'Human.Alias' },
        });
        expect(response.statusCode).toBe(403);
        expect(mocks.agentRepository.updateAlias).not.toHaveBeenCalled();
      } finally {
        await humanApp.close();
      }
    });

    it.each([
      ['team-bound', KEY_AUTH_CONTEXT],
      [
        'identity-bound',
        {
          ...VALID_AUTH_CONTEXT,
          credentialBinding: { bindingScope: 'identity', keyId: 'key-456' },
        } satisfies AuthContext,
      ],
    ])('rejects %s agent keys even with agent:profile', async (_, ctx) => {
      const keyApp = await createTestApp(mocks, ctx);
      try {
        const response = await keyApp.inject({
          method: 'PATCH',
          url: '/agents/whoami',
          headers: authHeaders,
          payload: { alias: 'Build.Agent' },
        });
        expect(response.statusCode).toBe(403);
        expect(response.json().detail).toContain('primary credential');
        expect(mocks.agentRepository.updateAlias).not.toHaveBeenCalled();
      } finally {
        await keyApp.close();
      }
    });

    it('rejects callers without agent:profile', async () => {
      const scopedApp = await createTestApp(mocks, {
        ...VALID_AUTH_CONTEXT,
        scopes: ['task:read'],
      });
      try {
        const response = await scopedApp.inject({
          method: 'PATCH',
          url: '/agents/whoami',
          headers: authHeaders,
          payload: { alias: 'Build.Agent' },
        });
        expect(response.statusCode).toBe(403);
        expect(mocks.agentRepository.updateAlias).not.toHaveBeenCalled();
      } finally {
        await scopedApp.close();
      }
    });

    it('returns not found when the authenticated subject row is missing', async () => {
      mocks.agentRepository.findById.mockResolvedValue(null);
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/whoami',
        headers: authHeaders,
        payload: { alias: 'Build.Agent' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /agents/whoami/alias', () => {
    it('withdraws the alias for the authenticated agent', async () => {
      mocks.agentRepository.updateAlias.mockResolvedValue(
        createMockAgent({ alias: null }),
      );

      const response = await app.inject({
        method: 'DELETE',
        url: '/agents/whoami/alias',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(204);
      expect(mocks.agentRepository.updateAlias).toHaveBeenCalledWith(
        OWNER_ID,
        null,
      );
    });

    it('rejects agent keys', async () => {
      const keyApp = await createTestApp(mocks, KEY_AUTH_CONTEXT);
      try {
        const response = await keyApp.inject({
          method: 'DELETE',
          url: '/agents/whoami/alias',
          headers: authHeaders,
        });
        expect(response.statusCode).toBe(403);
        expect(mocks.agentRepository.updateAlias).not.toHaveBeenCalled();
      } finally {
        await keyApp.close();
      }
    });

    it('rejects human callers', async () => {
      const humanApp = await createTestApp(mocks, HUMAN_AUTH_CONTEXT);
      try {
        const response = await humanApp.inject({
          method: 'DELETE',
          url: '/agents/whoami/alias',
          headers: authHeaders,
        });
        expect(response.statusCode).toBe(403);
      } finally {
        await humanApp.close();
      }
    });
  });
});
