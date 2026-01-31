import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  createMockServices,
  createTestApp,
  createMockAgent,
  OWNER_ID,
  type MockServices,
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
    it('returns enriched session', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
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
    });
  });
});
