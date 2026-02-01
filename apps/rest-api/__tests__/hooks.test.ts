import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockAgent,
  createMockServices,
  createTestApp,
  type MockServices,
  OWNER_ID,
  TEST_WEBHOOK_API_KEY,
} from './helpers.js';

describe('Hook routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    // Hooks don't require auth (they're called by Ory services)
    app = await createTestApp(mocks, null);
  });

  describe('POST /hooks/kratos/after-registration', () => {
    it('creates agent entry and registers in Keto', async () => {
      mocks.agentRepository.upsert.mockResolvedValue(createMockAgent());
      mocks.permissionChecker.registerAgent.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          identity: {
            id: OWNER_ID,
            traits: {
              moltbook_name: 'Claude',
              public_key: 'ed25519:AAAA+/bbbb==',
              key_fingerprint: 'A1B2-C3D4-E5F6-07A8',
            },
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
      expect(mocks.agentRepository.upsert).toHaveBeenCalledWith({
        identityId: OWNER_ID,
        moltbookName: 'Claude',
        publicKey: 'ed25519:AAAA+/bbbb==',
        fingerprint: 'A1B2-C3D4-E5F6-07A8',
      });
      expect(mocks.permissionChecker.registerAgent).toHaveBeenCalledWith(
        OWNER_ID,
      );
    });
  });

  describe('POST /hooks/kratos/after-settings', () => {
    it('updates agent entry', async () => {
      mocks.agentRepository.upsert.mockResolvedValue(
        createMockAgent({ publicKey: 'ed25519:NEWKEY==' }),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-settings',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          identity: {
            id: OWNER_ID,
            traits: {
              moltbook_name: 'Claude',
              public_key: 'ed25519:NEWKEY==',
              key_fingerprint: 'B2C3-D4E5-F607-A8B9',
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
        'moltnet:moltbook_name': 'Claude',
        'moltnet:public_key': 'ed25519:AAAA+/bbbb==',
        'moltnet:fingerprint': 'A1B2-C3D4-E5F6-07A8',
      });
    });

    it('falls back to minimal claims when agent not found', async () => {
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

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.session.access_token['moltnet:client_id']).toBe(
        'hydra-client-uuid',
      );
      expect(body.session.access_token['moltnet:identity_id']).toBe(OWNER_ID);
    });
  });

  describe('webhook API key validation', () => {
    it('rejects request without API key header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        payload: {
          identity: {
            id: OWNER_ID,
            traits: {
              moltbook_name: 'Claude',
              public_key: 'ed25519:AAAA+/bbbb==',
              key_fingerprint: 'A1B2-C3D4-E5F6-07A8',
            },
          },
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        error: 'UNAUTHORIZED',
        message: 'Missing webhook API key',
      });
    });

    it('rejects request with wrong API key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        headers: { 'x-ory-api-key': 'wrong-key' },
        payload: {
          identity: {
            id: OWNER_ID,
            traits: {
              moltbook_name: 'Claude',
              public_key: 'ed25519:AAAA+/bbbb==',
              key_fingerprint: 'A1B2-C3D4-E5F6-07A8',
            },
          },
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        error: 'UNAUTHORIZED',
        message: 'Invalid webhook API key',
      });
    });

    it('accepts request with valid API key', async () => {
      mocks.agentRepository.upsert.mockResolvedValue(createMockAgent());
      mocks.permissionChecker.registerAgent.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          identity: {
            id: OWNER_ID,
            traits: {
              moltbook_name: 'Claude',
              public_key: 'ed25519:AAAA+/bbbb==',
              key_fingerprint: 'A1B2-C3D4-E5F6-07A8',
            },
          },
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
