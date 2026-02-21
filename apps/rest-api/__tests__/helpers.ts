/**
 * Test helpers — mocks and fixtures for REST API tests
 */

import type {
  AuthContext,
  OryClients,
  PermissionChecker,
  RelationshipWriter,
  TokenValidator,
} from '@moltnet/auth';
import type { AgentKey, AgentVoucher, DiaryEntry } from '@moltnet/database';
import type { FastifyInstance } from 'fastify';
import { vi } from 'vitest';

import { buildApp } from '../src/app.js';
import type {
  AgentRepository,
  CryptoService,
  DataSource,
  DiaryEntryRepository,
  DiaryService,
  EmbeddingService,
  NonceRepository,
  SigningRequestRepository,
  TransactionRunner,
  VoucherRepository,
} from '../src/types.js';

export const TEST_WEBHOOK_API_KEY = 'test-webhook-api-key-for-testing';
export const TEST_RECOVERY_SECRET = 'test-recovery-secret-at-least-16-chars';
export const TEST_BEARER_TOKEN = 'test-token';
export const TEST_SECURITY_OPTIONS = {
  corsOrigins: 'http://localhost:3000,http://localhost:8000',
  rateLimitGlobalAuth: 1000, // Higher limits for tests
  rateLimitGlobalAnon: 1000,
  rateLimitEmbedding: 1000,
  rateLimitVouch: 1000,
  rateLimitSigning: 1000,
  rateLimitRecovery: 1000,
  rateLimitPublicVerify: 1000,
  rateLimitPublicSearch: 1000,
};
export const OWNER_ID = '550e8400-e29b-41d4-a716-446655440000';
export const OTHER_AGENT_ID = '660e8400-e29b-41d4-a716-446655440001';
export const ENTRY_ID = '770e8400-e29b-41d4-a716-446655440002';
export const DIARY_ID = '880e8400-e29b-41d4-a716-446655440004';

export const VALID_AUTH_CONTEXT: AuthContext = {
  identityId: OWNER_ID,
  publicKey: 'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=',
  fingerprint: 'C212-DAFA-27C5-6C57',
  clientId: 'hydra-client-uuid',
  scopes: ['diary:read', 'diary:write', 'agent:profile'],
};

export function createMockEntry(
  overrides: Partial<DiaryEntry> = {},
): DiaryEntry {
  return {
    id: ENTRY_ID,
    diaryId: DIARY_ID,
    title: null,
    content: 'Test diary entry content',
    embedding: null,
    tags: null,
    injectionRisk: false,
    importance: 5,
    accessCount: 0,
    lastAccessedAt: null,
    entryType: 'semantic' as const,
    supersededBy: null,
    createdAt: new Date('2026-01-30T10:00:00Z'),
    updatedAt: new Date('2026-01-30T10:00:00Z'),
    ...overrides,
  };
}

export function createMockAgent(overrides: Partial<AgentKey> = {}): AgentKey {
  return {
    identityId: OWNER_ID,
    publicKey: 'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=',
    fingerprint: 'C212-DAFA-27C5-6C57',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function createMockVoucher(
  overrides: Partial<AgentVoucher> = {},
): AgentVoucher {
  return {
    id: '880e8400-e29b-41d4-a716-446655440003',
    code: 'a'.repeat(64),
    issuerId: OWNER_ID,
    redeemedBy: null,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    redeemedAt: null,
    createdAt: new Date('2026-01-30T10:00:00Z'),
    ...overrides,
  };
}

export interface MockServices {
  diaryService: { [K in keyof DiaryService]: ReturnType<typeof vi.fn> };
  agentRepository: { [K in keyof AgentRepository]: ReturnType<typeof vi.fn> };
  cryptoService: { [K in keyof CryptoService]: ReturnType<typeof vi.fn> };
  voucherRepository: {
    [K in keyof VoucherRepository]: ReturnType<typeof vi.fn>;
  };
  embeddingService: {
    embedPassage: ReturnType<typeof vi.fn>;
    embedQuery: ReturnType<typeof vi.fn>;
  };
  signingRequestRepository: {
    [K in keyof SigningRequestRepository]: ReturnType<typeof vi.fn>;
  };
  nonceRepository: {
    [K in keyof NonceRepository]: ReturnType<typeof vi.fn>;
  };
  permissionChecker: {
    [K in keyof PermissionChecker]: ReturnType<typeof vi.fn>;
  };
  relationshipWriter: {
    [K in keyof RelationshipWriter]: ReturnType<typeof vi.fn>;
  };
  dataSource: {
    client: object;
    runTransaction: ReturnType<typeof vi.fn>;
  };
  transactionRunner: {
    [K in keyof TransactionRunner]: ReturnType<typeof vi.fn>;
  };
  diaryEntryRepository: {
    create: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    share: ReturnType<typeof vi.fn>;
    getSharedWithMe: ReturnType<typeof vi.fn>;
    getRecentForDigest: ReturnType<typeof vi.fn>;
    listPublic: ReturnType<typeof vi.fn>;
    listPublicSince: ReturnType<typeof vi.fn>;
    searchPublic: ReturnType<typeof vi.fn>;
    findPublicById: ReturnType<typeof vi.fn>;
  };
}

export function createMockServices(): MockServices {
  return {
    diaryService: {
      // Entry operations
      create: vi.fn(),
      getById: vi.fn(),
      list: vi.fn(),
      search: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      reflect: vi.fn(),
      // Diary container operations
      createDiary: vi.fn(),
      listDiaries: vi.fn().mockResolvedValue([]),
      findDiary: vi.fn(),
      findOwnedDiary: vi.fn(),
      updateDiary: vi.fn(),
      deleteDiary: vi.fn(),
      // Sharing operations
      listShares: vi.fn().mockResolvedValue([]),
      shareDiary: vi.fn(),
      listInvitations: vi.fn().mockResolvedValue([]),
      acceptInvitation: vi.fn(),
      declineInvitation: vi.fn(),
      revokeShare: vi.fn(),
    },
    diaryEntryRepository: {
      create: vi.fn(),
      findById: vi.fn(),
      list: vi.fn(),
      search: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      share: vi.fn(),
      getSharedWithMe: vi.fn(),
      getRecentForDigest: vi.fn(),
      listPublic: vi.fn(),
      listPublicSince: vi.fn(),
      searchPublic: vi.fn(),
      findPublicById: vi.fn(),
    },
    agentRepository: {
      findByFingerprint: vi.fn(),
      findByIdentityId: vi.fn(),
      findByPublicKey: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    cryptoService: {
      sign: vi.fn(),
      verify: vi.fn(),
      signWithNonce: vi.fn(),
      verifyWithNonce: vi.fn(),
      parsePublicKey: vi.fn(),
      generateKeyPair: vi.fn(),
      generateFingerprint: vi.fn(),
      createSignedMessage: vi.fn(),
      verifySignedMessage: vi.fn(),
      generateChallenge: vi.fn(),
      derivePublicKey: vi.fn(),
      getFingerprintFromPublicKey: vi.fn(),
      createIdentityProof: vi.fn(),
      verifyIdentityProof: vi.fn(),
    },
    voucherRepository: {
      issue: vi.fn(),
      redeem: vi.fn(),
      findByCode: vi.fn(),
      listActiveByIssuer: vi.fn(),
      getTrustGraph: vi.fn(),
    },
    embeddingService: {
      embedPassage: vi.fn().mockResolvedValue([]),
      embedQuery: vi.fn().mockResolvedValue([]),
    },
    signingRequestRepository: {
      create: vi.fn(),
      findBySignature: vi.fn(),
      findById: vi.fn(),
      list: vi.fn(),
      updateStatus: vi.fn(),
      countByAgent: vi.fn(),
    },
    nonceRepository: {
      consume: vi.fn().mockResolvedValue(true),
      cleanup: vi.fn(),
    },
    permissionChecker: {
      canReadDiary: vi.fn(),
      canWriteDiary: vi.fn(),
      canManageDiary: vi.fn(),
      canViewEntry: vi.fn(),
      canEditEntry: vi.fn(),
      canDeleteEntry: vi.fn(),
    },
    relationshipWriter: {
      grantDiaryOwner: vi.fn(),
      grantDiaryWriter: vi.fn(),
      grantDiaryReader: vi.fn(),
      removeDiaryRelations: vi.fn(),
      removeDiaryRelationForAgent: vi.fn(),
      grantOwnership: vi.fn(),
      registerAgent: vi.fn(),
      removeEntryRelations: vi.fn(),
    },
    dataSource: {
      client: { __mock: 'transactionalClient' },
      runTransaction: vi.fn().mockImplementation(async (fn) => fn()),
    },
    transactionRunner: {
      runInTransaction: vi.fn().mockImplementation(async (fn) => fn()),
    },
  };
}

/**
 * Creates a test Fastify app with mocked services and optional
 * auth context injection.
 */
export async function createTestApp(
  mocks: MockServices,
  authContext: AuthContext | null = null,
): Promise<FastifyInstance> {
  const mockTokenValidator: TokenValidator = {
    introspect: vi.fn().mockResolvedValue({ active: false }),
    resolveAuthContext: vi.fn().mockResolvedValue(authContext),
  };

  const mockOAuth2Api = {
    getOAuth2Client: vi.fn().mockResolvedValue({
      client_id: 'test-client-id',
      metadata: {
        identity_id: OWNER_ID,
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

  const app = await buildApp({
    diaryService: mocks.diaryService as unknown as DiaryService,
    diaryEntryRepository:
      mocks.diaryEntryRepository as unknown as DiaryEntryRepository,
    embeddingService: mocks.embeddingService as unknown as EmbeddingService,
    agentRepository: mocks.agentRepository as unknown as AgentRepository,
    cryptoService: mocks.cryptoService as unknown as CryptoService,
    voucherRepository: mocks.voucherRepository as unknown as VoucherRepository,
    signingRequestRepository:
      mocks.signingRequestRepository as unknown as SigningRequestRepository,
    nonceRepository: mocks.nonceRepository as unknown as NonceRepository,
    dataSource: mocks.dataSource as unknown as DataSource,
    transactionRunner: mocks.transactionRunner as unknown as TransactionRunner,
    permissionChecker: mocks.permissionChecker as unknown as PermissionChecker,
    relationshipWriter:
      mocks.relationshipWriter as unknown as RelationshipWriter,
    tokenValidator: mockTokenValidator,
    hydraPublicUrl: 'http://hydra-mock:4444',
    webhookApiKey: TEST_WEBHOOK_API_KEY,
    recoverySecret: TEST_RECOVERY_SECRET,
    oryClients: mockOryClients,
    security: TEST_SECURITY_OPTIONS,
  });

  return app;
}
