/**
 * Test helpers — mocks and fixtures for REST API tests
 */

import type {
  AuthContext,
  OryClients,
  PermissionChecker,
  TokenValidator,
} from '@moltnet/auth';
import type { FastifyInstance } from 'fastify';
import { vi } from 'vitest';

import { buildApp } from '../src/app.js';
import type {
  AgentKey,
  AgentRepository,
  AgentVoucher,
  CryptoService,
  DiaryEntry,
  DiaryService,
  VoucherRepository,
} from '../src/types.js';

export const TEST_WEBHOOK_API_KEY = 'test-webhook-api-key-for-testing';
export const TEST_BEARER_TOKEN = 'test-token';
export const OWNER_ID = '550e8400-e29b-41d4-a716-446655440000';
export const OTHER_AGENT_ID = '660e8400-e29b-41d4-a716-446655440001';
export const ENTRY_ID = '770e8400-e29b-41d4-a716-446655440002';

export const VALID_AUTH_CONTEXT: AuthContext = {
  identityId: OWNER_ID,
  publicKey: 'ed25519:AAAA+/bbbb==',
  fingerprint: 'A1B2-C3D4-E5F6-07A8',
  clientId: 'hydra-client-uuid',
  scopes: ['diary:read', 'diary:write', 'agent:profile'],
};

export function createMockEntry(
  overrides: Partial<DiaryEntry> = {},
): DiaryEntry {
  return {
    id: ENTRY_ID,
    ownerId: OWNER_ID,
    title: null,
    content: 'Test diary entry content',
    embedding: null,
    visibility: 'private',
    tags: null,
    createdAt: new Date('2026-01-30T10:00:00Z'),
    updatedAt: new Date('2026-01-30T10:00:00Z'),
    ...overrides,
  };
}

export function createMockAgent(overrides: Partial<AgentKey> = {}): AgentKey {
  return {
    identityId: OWNER_ID,
    publicKey: 'ed25519:AAAA+/bbbb==',
    fingerprint: 'A1B2-C3D4-E5F6-07A8',
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
  permissionChecker: {
    [K in keyof PermissionChecker]: ReturnType<typeof vi.fn>;
  };
}

export function createMockServices(): MockServices {
  return {
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
    },
    agentRepository: {
      findByFingerprint: vi.fn(),
      findByIdentityId: vi.fn(),
      upsert: vi.fn(),
    },
    cryptoService: {
      sign: vi.fn(),
      verify: vi.fn(),
      parsePublicKey: vi.fn(),
    },
    voucherRepository: {
      issue: vi.fn(),
      redeem: vi.fn(),
      findByCode: vi.fn(),
      listActiveByIssuer: vi.fn(),
      getTrustGraph: vi.fn(),
    },
    permissionChecker: {
      canViewEntry: vi.fn(),
      canEditEntry: vi.fn(),
      canDeleteEntry: vi.fn(),
      canShareEntry: vi.fn(),
      grantOwnership: vi.fn(),
      grantViewer: vi.fn(),
      revokeViewer: vi.fn(),
      registerAgent: vi.fn(),
      removeEntryRelations: vi.fn(),
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
      data: {
        client_id: 'test-client-id',
        metadata: {
          identity_id: OWNER_ID,
        },
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
    agentRepository: mocks.agentRepository as unknown as AgentRepository,
    cryptoService: mocks.cryptoService as unknown as CryptoService,
    voucherRepository: mocks.voucherRepository as unknown as VoucherRepository,
    permissionChecker: mocks.permissionChecker as unknown as PermissionChecker,
    tokenValidator: mockTokenValidator,
    webhookApiKey: TEST_WEBHOOK_API_KEY,
    oryClients: mockOryClients,
  });

  return app;
}
