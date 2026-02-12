import type {
  OryClients,
  PermissionChecker,
  TokenValidator,
} from '@moltnet/auth';
import { cryptoService } from '@moltnet/crypto-service';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import type {
  AgentRepository,
  CryptoService,
  DataSource,
  DiaryRepository,
  DiaryService,
  SigningRequestRepository,
  TransactionRunner,
  VoucherRepository,
} from '../src/types.js';
import {
  createMockAgent,
  createMockServices,
  createMockVoucher,
  type MockServices,
  OWNER_ID,
} from './helpers.js';

const TEST_PUBLIC_KEY = 'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=';
const TEST_FINGERPRINT = cryptoService.generateFingerprint(
  cryptoService.parsePublicKey(TEST_PUBLIC_KEY),
);
const TEST_VOUCHER_CODE = 'a'.repeat(64);

describe('Registration routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;
  let mockFrontendClient: {
    createNativeRegistrationFlow: ReturnType<typeof vi.fn>;
    updateRegistrationFlow: ReturnType<typeof vi.fn>;
  };
  let mockOAuth2CreateClient: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mocks = createMockServices();

    mockFrontendClient = {
      createNativeRegistrationFlow: vi.fn().mockResolvedValue({
        data: { id: 'flow-123' },
      }),
      updateRegistrationFlow: vi.fn().mockResolvedValue({
        data: {
          identity: {
            id: OWNER_ID,
            metadata_public: {
              fingerprint: TEST_FINGERPRINT,
              public_key: TEST_PUBLIC_KEY,
            },
          },
        },
      }),
    };

    mockOAuth2CreateClient = vi.fn().mockResolvedValue({
      data: {
        client_id: 'new-client-id',
        client_secret: 'new-client-secret',
      },
    });

    mocks.agentRepository.upsert.mockResolvedValue(createMockAgent());
    mocks.permissionChecker.registerAgent.mockResolvedValue(undefined);
    mocks.voucherRepository.updateRedeemedBy.mockResolvedValue(
      createMockVoucher({ redeemedBy: OWNER_ID }),
    );

    const mockTokenValidator: TokenValidator = {
      introspect: vi.fn().mockResolvedValue({ active: false }),
      resolveAuthContext: vi.fn().mockResolvedValue(null),
    };

    const mockOryClients: OryClients = {
      frontend: mockFrontendClient as unknown as OryClients['frontend'],
      identity: {} as OryClients['identity'],
      oauth2: {
        getOAuth2Client: vi.fn(),
        createOAuth2Client: mockOAuth2CreateClient,
      } as unknown as OryClients['oauth2'],
      permission: {} as OryClients['permission'],
      relationship: {} as OryClients['relationship'],
    };

    app = await buildApp({
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
      tokenValidator: mockTokenValidator,
      webhookApiKey: 'test-key',
      recoverySecret: 'test-recovery-secret-at-least-16-chars',
      oryClients: mockOryClients,
      security: {
        corsOrigins: 'http://localhost:3000',
        rateLimitGlobalAuth: 1000,
        rateLimitGlobalAnon: 1000,
        rateLimitEmbedding: 1000,
        rateLimitVouch: 1000,
        rateLimitSigning: 1000,
      },
    });
  });

  describe('POST /auth/register', () => {
    it('creates agent record with real identity ID from Kratos', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          public_key: TEST_PUBLIC_KEY,
          voucher_code: TEST_VOUCHER_CODE,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.identityId).toBe(OWNER_ID);
      expect(body.fingerprint).toBe(TEST_FINGERPRINT);
      expect(body.clientId).toBe('new-client-id');

      expect(mocks.agentRepository.upsert).toHaveBeenCalledWith({
        identityId: OWNER_ID,
        publicKey: TEST_PUBLIC_KEY,
        fingerprint: TEST_FINGERPRINT,
      });
    });

    it('registers agent in Keto with real identity ID', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          public_key: TEST_PUBLIC_KEY,
          voucher_code: TEST_VOUCHER_CODE,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.permissionChecker.registerAgent).toHaveBeenCalledWith(
        OWNER_ID,
      );
    });

    it('updates voucher redeemedBy with real identity ID', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          public_key: TEST_PUBLIC_KEY,
          voucher_code: TEST_VOUCHER_CODE,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.voucherRepository.updateRedeemedBy).toHaveBeenCalledWith(
        TEST_VOUCHER_CODE,
        OWNER_ID,
      );
    });

    it('does not call old delete+recreate hack', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          public_key: TEST_PUBLIC_KEY,
          voucher_code: TEST_VOUCHER_CODE,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.agentRepository.findByFingerprint).not.toHaveBeenCalled();
      expect(mocks.agentRepository.delete).not.toHaveBeenCalled();
    });

    it('propagates Kratos registration errors', async () => {
      mockFrontendClient.updateRegistrationFlow.mockRejectedValue({
        response: {
          status: 400,
          data: {
            ui: {
              messages: [
                {
                  id: 4000003,
                  text: 'Voucher code is invalid',
                  type: 'error',
                },
              ],
            },
          },
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          public_key: TEST_PUBLIC_KEY,
          voucher_code: 'invalid-code',
        },
      });

      expect(response.statusCode).toBe(403);
      expect(mocks.agentRepository.upsert).not.toHaveBeenCalled();
      expect(mocks.permissionChecker.registerAgent).not.toHaveBeenCalled();
    });
  });
});
