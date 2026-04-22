/**
 * Test helpers — mocks and fixtures for REST API tests
 */

import type {
  AuthContext,
  OryClients,
  PermissionChecker,
  RelationshipReader,
  RelationshipWriter,
  TokenValidator,
} from '@moltnet/auth';
import { ContextPackService } from '@moltnet/context-pack-service';
import type { Agent, AgentVoucher, DiaryEntry } from '@moltnet/database';
import type { FastifyInstance } from 'fastify';
import { vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { createAssertDiaryReadable } from '../src/services/diary-readable.js';
import type {
  AgentRepository,
  AttestationRepository,
  CryptoService,
  DataSource,
  DiaryEntryRepository,
  DiaryService,
  DiaryTransferRepository,
  EmbeddingService,
  GroupRepository,
  HumanRepository,
  NonceRepository,
  SigningRequestRepository,
  TaskRepository,
  TaskService,
  TeamRepository,
  TransactionRunner,
  VerificationService,
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
  rateLimitLegreffierStart: 1000,
  rateLimitLegreffierStatus: 1000,
  rateLimitRegistration: 1000,
  rateLimitReadiness: 1000,
  apiBaseUrl: 'http://localhost:8000',
};
export const OWNER_ID = '550e8400-e29b-41d4-a716-446655440000';
export const OTHER_AGENT_ID = '660e8400-e29b-41d4-a716-446655440001';
export const ENTRY_ID = '770e8400-e29b-41d4-a716-446655440002';
export const DIARY_ID = '880e8400-e29b-41d4-a716-446655440004';

export const VALID_AUTH_CONTEXT: AuthContext = {
  subjectType: 'agent',
  identityId: OWNER_ID,
  publicKey: 'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=',
  fingerprint: 'C212-DAFA-27C5-6C57',
  clientId: 'hydra-client-uuid',
  scopes: ['diary:read', 'diary:write', 'agent:profile'],
  currentTeamId: null,
};

export function createMockEntry(
  overrides: Partial<DiaryEntry> = {},
): DiaryEntry {
  return {
    id: ENTRY_ID,
    diaryId: DIARY_ID,
    createdBy: OWNER_ID,
    title: null,
    content: 'Test diary entry content',
    embedding: null,
    tags: null,
    injectionRisk: false,
    importance: 5,
    accessCount: 0,
    lastAccessedAt: null,
    entryType: 'semantic' as const,
    contentHash: null,
    contentSignature: null,
    createdAt: new Date('2026-01-30T10:00:00Z'),
    updatedAt: new Date('2026-01-30T10:00:00Z'),
    ...overrides,
  };
}

export function createMockAgent(overrides: Partial<Agent> = {}): Agent {
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
  diaryService: {
    [K in keyof DiaryService]: ReturnType<typeof vi.fn>;
  };
  agentRepository: { [K in keyof AgentRepository]: ReturnType<typeof vi.fn> };
  humanRepository: { [K in keyof HumanRepository]: ReturnType<typeof vi.fn> };
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
    findByIds: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    getRecentForDigest: ReturnType<typeof vi.fn>;
    listPublic: ReturnType<typeof vi.fn>;
    listPublicSince: ReturnType<typeof vi.fn>;
    searchPublic: ReturnType<typeof vi.fn>;
    findPublicById: ReturnType<typeof vi.fn>;
    fetchEmbeddings: ReturnType<typeof vi.fn>;
  };
  contextPackRepository: {
    createPack: ReturnType<typeof vi.fn>;
    addEntries: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findByCid: ReturnType<typeof vi.fn>;
    findByEntryId: ReturnType<typeof vi.fn>;
    listEntries: ReturnType<typeof vi.fn>;
    listEntriesExpanded: ReturnType<typeof vi.fn>;
    listEntriesExpandedByPackIds: ReturnType<typeof vi.fn>;
    listExpiredUnpinned: ReturnType<typeof vi.fn>;
    pin: ReturnType<typeof vi.fn>;
    unpin: ReturnType<typeof vi.fn>;
    updateExpiry: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    listByDiary: ReturnType<typeof vi.fn>;
  };
  renderedPackRepository: {
    findById: ReturnType<typeof vi.fn>;
    findLatestBySourcePackId: ReturnType<typeof vi.fn>;
    listBySourcePackIds: ReturnType<typeof vi.fn>;
    listByDiary: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    pin: ReturnType<typeof vi.fn>;
    unpin: ReturnType<typeof vi.fn>;
    updateExpiry: ReturnType<typeof vi.fn>;
  };
  attestationRepository: {
    [K in keyof AttestationRepository]: ReturnType<typeof vi.fn>;
  };
  verificationService: {
    [K in keyof VerificationService]: ReturnType<typeof vi.fn>;
  };
  contextPackService: {
    createCustomPack: ReturnType<typeof vi.fn>;
    createRenderedPack: ReturnType<typeof vi.fn>;
    previewRenderedPack: ReturnType<typeof vi.fn>;
    listPacksByEntry: ReturnType<typeof vi.fn>;
    getPackById: ReturnType<typeof vi.fn>;
    getPackForProvenance: ReturnType<typeof vi.fn>;
    listPacksByDiary: ReturnType<typeof vi.fn>;
    getLatestRenderedPack: ReturnType<typeof vi.fn>;
    getRenderedPackById: ReturnType<typeof vi.fn>;
    listRenderedPacksByDiary: ReturnType<typeof vi.fn>;
  };
  entryRelationRepository: {
    create: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    listByEntry: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  groupRepository: { [K in keyof GroupRepository]: ReturnType<typeof vi.fn> };
  teamRepository: { [K in keyof TeamRepository]: ReturnType<typeof vi.fn> };
  diaryTransferRepository: {
    create: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findByWorkflowId: ReturnType<typeof vi.fn>;
    findPendingByDiary: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
    listPendingByDestinationTeam: ReturnType<typeof vi.fn>;
  };
  relationshipReader: {
    [K in keyof RelationshipReader]: ReturnType<typeof vi.fn>;
  };
  taskRepository: { [K in keyof TaskRepository]: ReturnType<typeof vi.fn> };
  taskService: { [K in keyof TaskService]: ReturnType<typeof vi.fn> };
}

export function createMockServices(): MockServices {
  return {
    diaryService: {
      // Entry operations
      createEntry: vi.fn(),
      getEntryById: vi.fn(),
      listEntries: vi.fn(),
      listTags: vi.fn(),
      searchEntries: vi.fn(),
      searchOwned: vi.fn(),
      searchAccessible: vi.fn(),
      updateEntry: vi.fn(),
      deleteEntry: vi.fn(),
      reflect: vi.fn(),
      // Diary container operations
      createDiary: vi.fn(),
      listDiaries: vi.fn().mockResolvedValue([]),
      findDiary: vi.fn(),
      findOwnedDiary: vi.fn(),
      updateDiary: vi.fn(),
      deleteDiary: vi.fn(),
    },
    diaryEntryRepository: {
      create: vi.fn(),
      findById: vi.fn(),
      findByIds: vi.fn().mockResolvedValue([]),
      list: vi.fn(),
      search: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getRecentForDigest: vi.fn(),
      listPublic: vi.fn(),
      listPublicSince: vi.fn(),
      searchPublic: vi.fn(),
      findPublicById: vi.fn(),
      fetchEmbeddings: vi.fn().mockResolvedValue([]),
    },
    contextPackRepository: {
      createPack: vi.fn(),
      addEntries: vi.fn(),
      findById: vi.fn(),
      findByCid: vi.fn(),
      findByEntryId: vi.fn(),
      listEntries: vi.fn().mockResolvedValue([]),
      listEntriesExpanded: vi.fn().mockResolvedValue([]),
      listEntriesExpandedByPackIds: vi.fn().mockResolvedValue(new Map()),
      listExpiredUnpinned: vi.fn().mockResolvedValue([]),
      pin: vi.fn(),
      unpin: vi.fn(),
      updateExpiry: vi.fn(),
      deleteMany: vi.fn(),
      listByDiary: vi.fn().mockResolvedValue([]),
    },
    renderedPackRepository: {
      findById: vi.fn(),
      findLatestBySourcePackId: vi.fn(),
      listBySourcePackIds: vi.fn().mockResolvedValue([]),
      listByDiary: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      create: vi.fn(),
      pin: vi.fn(),
      unpin: vi.fn(),
      updateExpiry: vi.fn(),
    },
    attestationRepository: {
      create: vi.fn(),
      findByRenderedPackId: vi.fn().mockResolvedValue([]),
      findBestByRenderedPackId: vi.fn().mockResolvedValue(null),
    },
    verificationService: {
      createVerification: vi.fn(),
      claim: vi.fn(),
      submit: vi.fn(),
    },
    contextPackService: {
      createCustomPack: vi.fn(),
      createRenderedPack: vi.fn(),
      previewRenderedPack: vi.fn(),
      listPacksByEntry: vi.fn(),
      getPackById: vi.fn(),
      getPackForProvenance: vi.fn(),
      listPacksByDiary: vi.fn(),
      getLatestRenderedPack: vi.fn(),
      getRenderedPackById: vi.fn(),
      listRenderedPacksByDiary: vi.fn(),
    },
    entryRelationRepository: {
      create: vi.fn(),
      createMany: vi.fn().mockResolvedValue([]),
      findById: vi.fn(),
      listByEntry: vi.fn().mockResolvedValue([]),
      updateStatus: vi.fn(),
      delete: vi.fn(),
    },
    groupRepository: {
      create: vi.fn(),
      findById: vi.fn(),
      listByTeamId: vi.fn().mockResolvedValue([]),
      delete: vi.fn(),
    },
    humanRepository: {
      create: vi.fn(),
      findById: vi.fn(),
      findByIdentityId: vi.fn(),
      setIdentityId: vi.fn(),
      clearIdentityId: vi.fn(),
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
      issueUnlimited: vi.fn(),
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
      canEditAnyEntry: vi.fn(),
      canReadPack: vi.fn(),
      canReadPacks: vi.fn().mockResolvedValue(new Map()),
      canManagePack: vi.fn(),
      canVerifyClaimPack: vi.fn(),
      canAccessTeam: vi.fn(),
      canManageTeam: vi.fn(),
      canWriteTeam: vi.fn().mockResolvedValue(true),
      canManageTeamMembers: vi.fn(),
      canViewTask: vi.fn(),
      canImposeTask: vi.fn(),
      canClaimTask: vi.fn(),
      canCancelTask: vi.fn(),
      canReportTask: vi.fn(),
    },
    relationshipWriter: {
      grantDiaryTeam: vi.fn(),
      removeDiaryTeam: vi.fn(),
      removeDiaryRelations: vi.fn(),
      grantEntryParent: vi.fn(),
      grantPackParent: vi.fn(),
      registerAgent: vi.fn(),
      registerHuman: vi.fn(),
      grantTeamOwners: vi.fn(),
      grantTeamManagers: vi.fn(),
      grantTeamMembers: vi.fn(),
      removeTeamMemberRelation: vi.fn(),
      grantGroupParent: vi.fn(),
      grantGroupMember: vi.fn(),
      removeGroupMember: vi.fn(),
      removeGroupRelations: vi.fn(),
      removeEntryRelations: vi.fn(),
      removePackRelations: vi.fn(),
      removePackRelationsBatch: vi.fn(),
      grantDiaryWriters: vi.fn(),
      grantDiaryManagers: vi.fn(),
      revokeDiaryWriter: vi.fn(),
      revokeDiaryManager: vi.fn(),
      grantTaskParent: vi.fn(),
      grantTaskClaimant: vi.fn(),
      removeTaskClaimant: vi.fn(),
    },
    dataSource: {
      client: { __mock: 'transactionalClient' },
      runTransaction: vi.fn().mockImplementation(async (fn) => fn()),
    },
    transactionRunner: {
      runInTransaction: vi.fn().mockImplementation(async (fn) => fn()),
    },
    teamRepository: {
      create: vi.fn(),
      findById: vi.fn(),
      listByIds: vi.fn().mockResolvedValue([]),
      findPersonalByCreator: vi.fn(),
      updateStatus: vi.fn(),
      delete: vi.fn(),
      createInvite: vi.fn(),
      findInviteByCode: vi.fn(),
      claimInvite: vi.fn(),
      incrementInviteUseCount: vi.fn(),
      listInvites: vi.fn(),
      deleteInvite: vi.fn(),
      deleteInviteByTeam: vi.fn(),
      revertInviteClaim: vi.fn().mockResolvedValue(null),
      createFoundingAcceptance: vi.fn(),
      listFoundingAcceptances: vi.fn().mockResolvedValue([]),
      acceptFoundingMember: vi.fn(),
    },
    diaryTransferRepository: {
      create: vi.fn(),
      findById: vi.fn(),
      findByWorkflowId: vi.fn(),
      findPendingByDiary: vi.fn().mockResolvedValue(null),
      updateStatus: vi.fn(),
      listPendingByDestinationTeam: vi.fn().mockResolvedValue([]),
    },
    relationshipReader: {
      listTeamIdsBySubject: vi.fn().mockResolvedValue([]),
      listTeamIdsAndRolesBySubject: vi.fn().mockResolvedValue([]),
      listTeamMembers: vi.fn().mockResolvedValue([]),
      listGroupMembers: vi.fn().mockResolvedValue([]),
    },
    taskRepository: {
      create: vi.fn(),
      findById: vi.fn(),
      list: vi.fn(),
      updateStatus: vi.fn(),
      createAttempt: vi.fn(),
      findAttempt: vi.fn(),
      updateAttempt: vi.fn(),
      listAttempts: vi.fn().mockResolvedValue([]),
      countAttempts: vi.fn().mockResolvedValue(0),
      getMaxAttempts: vi.fn().mockResolvedValue(1),
      appendMessages: vi.fn(),
      listMessages: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    },
    taskService: {
      create: vi.fn(),
      list: vi.fn(),
      get: vi.fn(),
      claim: vi.fn(),
      heartbeat: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      cancel: vi.fn(),
      listAttempts: vi.fn(),
      listMessages: vi.fn(),
      appendMessages: vi.fn(),
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
  securityOverrides?: Partial<typeof TEST_SECURITY_OPTIONS>,
  healthOptions?: {
    pool?: { query(sql: string): Promise<unknown> };
    oryProjectUrl?: string;
  },
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

  const mockIdentityApi = {
    listIdentitySchemas: vi.fn().mockResolvedValue([
      {
        id: 'moltnet_agent',
        schema: { $id: 'https://schemas.themolt.net/agent.json' },
      },
      {
        id: 'moltnet_human',
        schema: { $id: 'https://schemas.themolt.net/human.json' },
      },
    ]),
  } as unknown as OryClients['identity'];

  const mockOryClients: OryClients = {
    frontend: {} as OryClients['frontend'],
    identity: mockIdentityApi,
    oauth2: mockOAuth2Api,
    permission: {} as OryClients['permission'],
    relationship: {} as OryClients['relationship'],
  };

  const realContextPackService = new ContextPackService({
    contextPackRepository: mocks.contextPackRepository as never,
    renderedPackRepository: mocks.renderedPackRepository as never,
    diaryEntryRepository:
      mocks.diaryEntryRepository as unknown as DiaryEntryRepository,
    permissionChecker: mocks.permissionChecker as unknown as PermissionChecker,
    entryFetcher: {
      fetchEntries: async (diaryId: string, ids: string[]) => {
        const { items } = await mocks.diaryEntryRepository.list({
          diaryId,
          ids,
          limit: ids.length,
        });
        return items;
      },
    },
    runTransaction: <T>(fn: () => Promise<T>) =>
      mocks.dataSource.runTransaction(fn),
    grantPackParent: (packId: string, diaryId: string) =>
      mocks.relationshipWriter.grantPackParent(packId, diaryId),
    removePackRelations: (packId: string) =>
      mocks.relationshipWriter.removePackRelations(packId),
    deleteMany: (ids: string[]) => mocks.contextPackRepository.deleteMany(ids),
    assertDiaryReadable: createAssertDiaryReadable(
      mocks.diaryService as unknown as DiaryService,
    ),
    ttlDays: 7,
  });
  // Allow individual tests to stub specific service methods via
  // `mocks.contextPackService.<method>.mockResolvedValue(...)` while
  // falling through to the real service for everything else.
  //
  // NOTE: only mockResolvedValue / mockRejectedValue / mockImplementation
  // activate this intercept (they all install a mock implementation).
  // mockReturnValue does NOT set getMockImplementation() and will silently
  // fall through to the real service — use mockResolvedValue instead when
  // stubbing these async methods.
  const serviceProxy = new Proxy(realContextPackService, {
    get(target, prop: string, receiver) {
      const mock = (mocks.contextPackService as Record<string, unknown>)[prop];
      if (typeof mock === 'function') {
        const fn = mock as ReturnType<typeof vi.fn>;
        if (fn.getMockImplementation()) {
          return fn;
        }
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  const app = await buildApp({
    diaryService: mocks.diaryService as unknown as DiaryService,
    diaryEntryRepository:
      mocks.diaryEntryRepository as unknown as DiaryEntryRepository,
    contextPackRepository: mocks.contextPackRepository as never,
    renderedPackRepository: mocks.renderedPackRepository as never,
    attestationRepository:
      mocks.attestationRepository as unknown as AttestationRepository,
    entryRelationRepository: mocks.entryRelationRepository as never,
    contextPackService: serviceProxy as never,
    verificationService:
      mocks.verificationService as unknown as VerificationService,
    embeddingService: mocks.embeddingService as unknown as EmbeddingService,
    agentRepository: mocks.agentRepository as unknown as AgentRepository,
    humanRepository: mocks.humanRepository as unknown as HumanRepository,
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
    teamResolver: {
      findPersonalTeamId: async () => null,
    },
    teamRepository: mocks.teamRepository as never,
    taskRepository: mocks.taskRepository as unknown as TaskRepository,
    taskService: mocks.taskService as unknown as TaskService,
    diaryTransferRepository:
      mocks.diaryTransferRepository as unknown as DiaryTransferRepository,
    groupRepository: mocks.groupRepository as never,
    relationshipReader: mocks.relationshipReader as never,
    hydraPublicUrl: 'http://hydra-mock:4444',
    webhookApiKey: TEST_WEBHOOK_API_KEY,
    recoverySecret: TEST_RECOVERY_SECRET,
    oryClients: mockOryClients,
    security: { ...TEST_SECURITY_OPTIONS, ...securityOverrides },
    packGcConfig: {
      PACK_GC_COMPILE_TTL_DAYS: 7,
      PACK_GC_CRON: '0 * * * *',
      PACK_GC_BATCH_SIZE: 100,
    },
    pool: healthOptions?.pool,
    oryProjectUrl: healthOptions?.oryProjectUrl,
  });

  return app;
}
