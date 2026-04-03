import type { FastifyInstance } from 'fastify';
import type { vi } from 'vitest';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockAgent,
  createMockServices,
  createTestApp,
  type MockServices,
  OWNER_ID,
  TEST_WEBHOOK_API_KEY,
} from './helpers.js';

const HUMAN_ID = '110e8400-e29b-41d4-a716-446655440099';

describe('Hook routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    // Hooks don't require auth (they're called by Ory services)
    app = await createTestApp(mocks, null);
  });

  describe('POST /hooks/kratos/after-registration', () => {
    const validHumanPayload = {
      identity: {
        id: '00000000-0000-0000-0000-000000000000', // empty UUID from Kratos
        schema_id: 'moltnet_human',
        traits: {
          email: 'human@test.local',
          username: 'testuser',
        },
      },
    };

    it('creates human placeholder when schema is human', async () => {
      mocks.humanRepository.create.mockResolvedValue({
        id: HUMAN_ID,
        identityId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: validHumanPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.identity.metadata_public).toEqual({
        human_id: HUMAN_ID,
      });
      expect(mocks.humanRepository.create).toHaveBeenCalled();
    });

    it('rejects non-human schema registration', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          identity: {
            id: OWNER_ID,
            schema_id: 'moltnet_agent',
            traits: { email: 'a@b.c', username: 'x' },
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].messages[0].id).toBe(4000010);
      expect(mocks.humanRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('POST /hooks/kratos/after-settings', () => {
    it('updates agent entry', async () => {
      mocks.agentRepository.upsert.mockResolvedValue(
        createMockAgent({
          publicKey: 'ed25519:bW9sdG5ldC10ZXN0LWtleS0yLWZvci11bml0LXRlc3Q=',
        }),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-settings',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          identity: {
            id: OWNER_ID,
            traits: {
              public_key:
                'ed25519:bW9sdG5ldC10ZXN0LWtleS0yLWZvci11bml0LXRlc3Q=',
            },
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
    });
  });

  describe('POST /hooks/hydra/token-exchange', () => {
    it('enriches token with agent claims', async () => {
      mocks.agentRepository.findByIdentityId.mockResolvedValue(
        createMockAgent(),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: {},
          request: {
            client_id: 'hydra-client-uuid',
            grant_types: ['client_credentials'],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.session.access_token).toEqual({
        'moltnet:identity_id': OWNER_ID,
        'moltnet:public_key':
          'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=',
        'moltnet:fingerprint': 'C212-DAFA-27C5-6C57',
        'moltnet:subject_type': 'agent',
      });
    });

    it('enriches token with human claims from session', async () => {
      // Client has no MoltNet agent metadata (DCR client)
      (
        app as { oauth2Client: { getOAuth2Client: ReturnType<typeof vi.fn> } }
      ).oauth2Client.getOAuth2Client.mockResolvedValueOnce({
        client_id: 'dcr-client',
        metadata: {},
      });

      mocks.humanRepository.findByIdentityId.mockResolvedValue({
        id: HUMAN_ID,
        identityId: OWNER_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: {
            access_token: {
              'moltnet:identity_id': OWNER_ID,
              'moltnet:subject_type': 'human',
            },
          },
          request: {
            client_id: 'dcr-client',
            grant_types: ['authorization_code'],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.session.access_token).toEqual({
        'moltnet:identity_id': OWNER_ID,
        'moltnet:subject_type': 'human',
      });
    });

    it('rejects with 403 when agent not found', async () => {
      mocks.agentRepository.findByIdentityId.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: {},
          request: {
            client_id: 'hydra-client-uuid',
            grant_types: ['client_credentials'],
          },
        },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error).toBe('agent_not_found');
    });

    it('rejects with 403 when no identity found', async () => {
      // Client has no MoltNet metadata, no session claims
      (
        app as { oauth2Client: { getOAuth2Client: ReturnType<typeof vi.fn> } }
      ).oauth2Client.getOAuth2Client.mockResolvedValueOnce({
        client_id: 'unknown-client',
        metadata: {},
      });

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: {},
          request: {
            client_id: 'unknown-client',
            grant_types: ['client_credentials'],
          },
        },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error).toBe('identity_not_found');
    });

    it('returns 500 when OAuth2 client fetch fails', async () => {
      (
        app as { oauth2Client: { getOAuth2Client: ReturnType<typeof vi.fn> } }
      ).oauth2Client.getOAuth2Client.mockRejectedValueOnce(
        new Error('Hydra connection error'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: {},
          request: {
            client_id: 'hydra-client-uuid',
            grant_types: ['client_credentials'],
          },
        },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.error).toBe('enrichment_failed');
    });
  });

  describe('webhook API key validation', () => {
    const validHumanPayload = {
      identity: {
        id: '00000000-0000-0000-0000-000000000000',
        schema_id: 'moltnet_human',
        traits: { email: 'a@b.c', username: 'test' },
      },
    };

    it('rejects request without API key header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        payload: validHumanPayload,
      });

      expect(response.statusCode).toBe(401);
      expect(response.headers['content-type']).toContain('application/json');
      const body = response.json();
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body.detail).toBe('Missing webhook API key');
    });

    it('rejects request with wrong API key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        headers: { 'x-ory-api-key': 'wrong-key' },
        payload: validHumanPayload,
      });

      expect(response.statusCode).toBe(401);
      expect(response.headers['content-type']).toContain('application/json');
      const body = response.json();
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body.detail).toBe('Invalid webhook API key');
    });

    it('accepts request with valid API key', async () => {
      mocks.humanRepository.create.mockResolvedValue({
        id: HUMAN_ID,
        identityId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: validHumanPayload,
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
