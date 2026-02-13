import type { OryClients } from '@moltnet/auth';
import { cryptoService } from '@moltnet/crypto-service';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import type {
  DataSource,
  DiaryRepository,
  DiaryService,
  SigningRequestRepository,
  TransactionRunner,
} from '../src/types.js';
import {
  createMockAgent,
  createMockServices,
  createMockVoucher,
  createTestApp,
  type MockServices,
  OWNER_ID,
  TEST_RECOVERY_SECRET,
  TEST_SECURITY_OPTIONS,
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
    const testPublicKey =
      'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=';
    const expectedFingerprint = cryptoService.generateFingerprint(
      cryptoService.parsePublicKey(testPublicKey),
    );

    const validPayload = {
      identity: {
        id: OWNER_ID,
        traits: {
          public_key: testPublicKey,
          voucher_code: 'a'.repeat(64),
        },
      },
    };

    it('validates public key format and returns fingerprint', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.identity.metadata_public).toEqual({
        fingerprint: expectedFingerprint,
        public_key: testPublicKey,
      });
      // Webhook no longer does voucher or agent operations
      expect(mocks.voucherRepository.redeem).not.toHaveBeenCalled();
      expect(mocks.agentRepository.upsert).not.toHaveBeenCalled();
      expect(mocks.permissionChecker.registerAgent).not.toHaveBeenCalled();
    });

    it('rejects registration with invalid voucher (Ory error format)', async () => {
      // This test is no longer relevant - webhook doesn't validate vouchers
      // Voucher validation happens in the DBOS workflow now
    });

    it('rejects registration with invalid public_key format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          identity: {
            id: OWNER_ID,
            traits: {
              public_key: 'rsa:not-an-ed25519-key',
              voucher_code: 'a'.repeat(64),
            },
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].instance_ptr).toBe('#/traits/public_key');
      expect(body.messages[0].messages[0].id).toBe(4000001);
      expect(body.messages[0].messages[0].text).toContain('32 bytes');
      expect(mocks.voucherRepository.redeem).not.toHaveBeenCalled();
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
      });
    });

    it('returns error when agent not found', async () => {
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

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.error).toBe('token_enrichment_failed');
      expect(body.error_description).toContain('Agent record not found');
    });

    it('returns error when OAuth2 client has no MoltNet metadata', async () => {
      const mockOAuth2Api = {
        getOAuth2Client: vi.fn().mockResolvedValue({
          data: {
            client_id: 'test-client-id',
            metadata: {}, // No identity_id
          },
        }),
      } as unknown as OryClients['oauth2'];

      const mockOryClients: OryClients = {
        frontend: {} as OryClients['frontend'],
        identity: {} as OryClients['identity'],
        oauth2: mockOAuth2Api,
        permission: {} as OryClients['permission'],
        relationship: {} as OryClients['relationship'],
      };

      // Create a new app with this mock
      const testApp = await buildApp({
        diaryService: mocks.diaryService as unknown as DiaryService,
        diaryRepository: mocks.diaryRepository as unknown as DiaryRepository,
        agentRepository: mocks.agentRepository as unknown as AgentRepository,
        cryptoService: mocks.cryptoService as unknown as CryptoService,
        voucherRepository:
          mocks.voucherRepository as unknown as VoucherRepository,
        signingRequestRepository:
          mocks.signingRequestRepository as unknown as SigningRequestRepository,
        dataSource: mocks.dataSource as unknown as DataSource,
        transactionRunner:
          mocks.transactionRunner as unknown as TransactionRunner,
        permissionChecker:
          mocks.permissionChecker as unknown as PermissionChecker,
        tokenValidator: {
          introspect: vi.fn().mockResolvedValue({ active: false }),
          resolveAuthContext: vi.fn().mockResolvedValue(null),
        },
        webhookApiKey: TEST_WEBHOOK_API_KEY,
        recoverySecret: TEST_RECOVERY_SECRET,
        oryClients: mockOryClients,
        security: TEST_SECURITY_OPTIONS,
      });

      const response = await testApp.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: {},
          request: {
            client_id: 'test-client-id',
            grant_types: ['client_credentials'],
          },
        },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.error).toBe('token_enrichment_failed');
      expect(body.error_description).toContain(
        'missing required MoltNet metadata',
      );
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
              public_key:
                'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=',
              voucher_code: 'a'.repeat(64),
            },
          },
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      const body = response.json();
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body.detail).toBe('Missing webhook API key');
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
              public_key:
                'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=',
              voucher_code: 'a'.repeat(64),
            },
          },
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      const body = response.json();
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body.detail).toBe('Invalid webhook API key');
    });

    it('accepts request with valid API key', async () => {
      mocks.voucherRepository.redeem.mockResolvedValue(createMockVoucher());
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
              public_key:
                'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=',
              voucher_code: 'a'.repeat(64),
            },
          },
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
