import type {
  AuthContext,
  OryClients,
  PermissionChecker,
  RelationshipWriter,
  TokenValidator,
} from '@moltnet/auth';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import type {
  AgentRepository,
  CryptoService,
  DiaryService,
  SigningRequestRecord,
  SigningRequestRepository,
  VoucherRepository,
} from '../src/types.js';

// Mock DBOS SDK
vi.mock('@moltnet/database', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    DBOS: {
      startWorkflow: vi.fn().mockReturnValue(
        vi.fn().mockResolvedValue({
          workflowID: 'workflow-123',
        }),
      ),
      send: vi.fn().mockResolvedValue(undefined),
    },
    signingWorkflows: {
      requestSignature: vi.fn(),
    },
  };
});

const OWNER_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_AGENT_ID = '660e8400-e29b-41d4-a716-446655440001';
const REQUEST_ID = '990e8400-e29b-41d4-a716-446655440010';

const VALID_AUTH_CONTEXT: AuthContext = {
  identityId: OWNER_ID,
  publicKey: 'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=',
  fingerprint: 'C212-DAFA-27C5-6C57',
  clientId: 'hydra-client-uuid',
  scopes: ['diary:read', 'diary:write', 'agent:profile'],
};

function createMockSigningRequest(
  overrides: Partial<SigningRequestRecord> = {},
): SigningRequestRecord {
  return {
    id: REQUEST_ID,
    agentId: OWNER_ID,
    message: 'Hello, world!',
    nonce: 'aaa08400-e29b-41d4-a716-446655440011',
    status: 'pending',
    signature: null,
    valid: null,
    workflowId: 'workflow-123',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 300_000),
    completedAt: null,
    ...overrides,
  };
}

function createSigningRepo() {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    updateStatus: vi.fn(),
    countByAgent: vi.fn(),
  };
}

function createApp(
  signingRepo: ReturnType<typeof createSigningRepo>,
  authContext: AuthContext | null = VALID_AUTH_CONTEXT,
) {
  const mockTokenValidator: TokenValidator = {
    introspect: vi.fn().mockResolvedValue({ active: false }),
    resolveAuthContext: vi.fn().mockResolvedValue(authContext),
  };

  const mockOAuth2Api = {
    getOAuth2Client: vi.fn().mockResolvedValue({
      data: {
        client_id: 'test-client-id',
        metadata: { identity_id: OWNER_ID },
      },
    }),
  } as unknown as OryClients['oauth2'];

  return buildApp({
    diaryService: {
      create: vi.fn(),
      getById: vi.fn(),
      list: vi.fn(),
      search: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      share: vi.fn(),
      getSharedWithMe: vi.fn(),
      reflect: vi.fn(),
    } as unknown as DiaryService,
    diaryRepository: new Proxy(
      {},
      { get: () => vi.fn().mockResolvedValue(null) },
    ) as never,
    agentRepository: {
      findByFingerprint: vi.fn(),
      findByIdentityId: vi.fn(),
      findByPublicKey: vi.fn(),
      upsert: vi.fn(),
    } as unknown as AgentRepository,
    cryptoService: {
      sign: vi.fn(),
      verify: vi.fn(),
      parsePublicKey: vi.fn(),
    } as unknown as CryptoService,
    voucherRepository: {
      issue: vi.fn(),
      redeem: vi.fn(),
      findByCode: vi.fn(),
      listActiveByIssuer: vi.fn(),
      getTrustGraph: vi.fn(),
    } as unknown as VoucherRepository,
    signingRequestRepository:
      signingRepo as unknown as SigningRequestRepository,
    dataSource: {
      client: { __mock: 'transactionalClient' },
      runTransaction: vi.fn().mockImplementation(async (fn) => fn()),
    },
    nonceRepository: {
      consume: vi.fn().mockResolvedValue(true),
      cleanup: vi.fn(),
    } as never,
    transactionRunner: {
      runInTransaction: vi.fn().mockImplementation(async (fn) => fn()),
    } as never,
    embeddingService: {
      embedPassage: vi.fn().mockResolvedValue([]),
      embedQuery: vi.fn().mockResolvedValue([]),
    } as never,
    permissionChecker: {
      canViewEntry: vi.fn(),
      canEditEntry: vi.fn(),
      canDeleteEntry: vi.fn(),
      canShareEntry: vi.fn(),
    } as unknown as PermissionChecker,
    relationshipWriter: {
      grantOwnership: vi.fn(),
      grantViewer: vi.fn(),
      registerAgent: vi.fn(),
      removeEntryRelations: vi.fn(),
    } as unknown as RelationshipWriter,
    tokenValidator: mockTokenValidator,
    webhookApiKey: 'test-webhook-api-key',
    recoverySecret: 'test-recovery-secret-at-least-16-chars',
    oryClients: {
      frontend: {} as OryClients['frontend'],
      identity: {} as OryClients['identity'],
      oauth2: mockOAuth2Api,
      permission: {} as OryClients['permission'],
      relationship: {} as OryClients['relationship'],
    },
    security: {
      corsOrigins: 'http://localhost:3000',
      rateLimitGlobalAuth: 1000,
      rateLimitGlobalAnon: 1000,
      rateLimitEmbedding: 1000,
      rateLimitVouch: 1000,
      rateLimitSigning: 1000,
      rateLimitRecovery: 1000,
      rateLimitPublicVerify: 1000,
      rateLimitPublicSearch: 1000,
    },
  });
}

describe('Signing request routes', () => {
  let app: FastifyInstance;
  let signingRepo: ReturnType<typeof createSigningRepo>;

  beforeEach(async () => {
    signingRepo = createSigningRepo();
    app = await createApp(signingRepo);
  });

  describe('POST /crypto/signing-requests', () => {
    it('creates a signing request and returns 201', async () => {
      const mockReq = createMockSigningRequest();
      signingRepo.create.mockResolvedValue(mockReq);
      signingRepo.updateStatus.mockResolvedValue(mockReq);

      const response = await app.inject({
        method: 'POST',
        url: '/crypto/signing-requests',
        headers: { authorization: 'Bearer test-token' },
        payload: { message: 'Hello, world!' },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.id).toBe(REQUEST_ID);
      expect(body.message).toBe('Hello, world!');
      expect(body.status).toBe('pending');
      expect(signingRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: OWNER_ID,
          message: 'Hello, world!',
        }),
      );
    });

    it('returns 401 without auth', async () => {
      const unauthApp = await createApp(signingRepo, null);

      const response = await unauthApp.inject({
        method: 'POST',
        url: '/crypto/signing-requests',
        payload: { message: 'test' },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /crypto/signing-requests', () => {
    it('lists signing requests for authenticated agent', async () => {
      const mockReq = createMockSigningRequest();
      signingRepo.list.mockResolvedValue({ items: [mockReq], total: 1 });

      const response = await app.inject({
        method: 'GET',
        url: '/crypto/signing-requests',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(signingRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: OWNER_ID }),
      );
    });

    it('filters by status when provided', async () => {
      signingRepo.list.mockResolvedValue({ items: [], total: 0 });

      await app.inject({
        method: 'GET',
        url: '/crypto/signing-requests?status=pending',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(signingRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ status: ['pending'] }),
      );
    });
  });

  describe('GET /crypto/signing-requests/:id', () => {
    it('returns a signing request for the owner', async () => {
      const mockReq = createMockSigningRequest();
      signingRepo.findById.mockResolvedValue(mockReq);

      const response = await app.inject({
        method: 'GET',
        url: `/crypto/signing-requests/${REQUEST_ID}`,
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(REQUEST_ID);
    });

    it('returns 404 for non-existent request', async () => {
      signingRepo.findById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: `/crypto/signing-requests/${REQUEST_ID}`,
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for request owned by different agent', async () => {
      const otherReq = createMockSigningRequest({ agentId: OTHER_AGENT_ID });
      signingRepo.findById.mockResolvedValue(otherReq);

      const response = await app.inject({
        method: 'GET',
        url: `/crypto/signing-requests/${REQUEST_ID}`,
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /crypto/signing-requests/:id/sign', () => {
    it('submits a signature and returns updated request', async () => {
      const pending = createMockSigningRequest();
      const completed = createMockSigningRequest({
        status: 'completed',
        signature: 'ed25519:sig123',
        valid: true,
        completedAt: new Date(),
      });

      signingRepo.findById
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(completed);

      const response = await app.inject({
        method: 'POST',
        url: `/crypto/signing-requests/${REQUEST_ID}/sign`,
        headers: { authorization: 'Bearer test-token' },
        payload: { signature: 'ed25519:sig123' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('completed');
      expect(body.valid).toBe(true);
    });

    it('returns 409 for expired request', async () => {
      const expired = createMockSigningRequest({ status: 'expired' });
      signingRepo.findById.mockResolvedValue(expired);

      const response = await app.inject({
        method: 'POST',
        url: `/crypto/signing-requests/${REQUEST_ID}/sign`,
        headers: { authorization: 'Bearer test-token' },
        payload: { signature: 'ed25519:sig123' },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('SIGNING_REQUEST_EXPIRED');
    });

    it('returns 409 for already completed request', async () => {
      const completed = createMockSigningRequest({
        status: 'completed',
        expiresAt: new Date(Date.now() + 60_000),
      });
      signingRepo.findById.mockResolvedValue(completed);

      const response = await app.inject({
        method: 'POST',
        url: `/crypto/signing-requests/${REQUEST_ID}/sign`,
        headers: { authorization: 'Bearer test-token' },
        payload: { signature: 'ed25519:sig123' },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('SIGNING_REQUEST_ALREADY_COMPLETED');
    });

    it('returns 404 for request owned by different agent', async () => {
      const otherReq = createMockSigningRequest({ agentId: OTHER_AGENT_ID });
      signingRepo.findById.mockResolvedValue(otherReq);

      const response = await app.inject({
        method: 'POST',
        url: `/crypto/signing-requests/${REQUEST_ID}/sign`,
        headers: { authorization: 'Bearer test-token' },
        payload: { signature: 'ed25519:sig123' },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
