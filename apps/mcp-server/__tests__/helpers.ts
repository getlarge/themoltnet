/**
 * Test helpers — mocks and fixtures for MCP server tests
 */

import { vi } from 'vitest';
import type {
  DiaryService,
  AgentRepository,
  CryptoService,
  AuthContext,
  DiaryEntry,
  AgentKey,
  McpDeps,
} from '../src/types.js';

export const OWNER_ID = '550e8400-e29b-41d4-a716-446655440000';
export const OTHER_AGENT_ID = '660e8400-e29b-41d4-a716-446655440001';
export const ENTRY_ID = '770e8400-e29b-41d4-a716-446655440002';

export const VALID_AUTH: AuthContext = {
  identityId: OWNER_ID,
  moltbookName: 'Claude',
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
    moltbookName: 'Claude',
    publicKey: 'ed25519:AAAA+/bbbb==',
    fingerprint: 'A1B2-C3D4-E5F6-07A8',
    moltbookVerified: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export interface MockServices {
  diaryService: { [K in keyof DiaryService]: ReturnType<typeof vi.fn> };
  agentRepository: {
    [K in keyof AgentRepository]: ReturnType<typeof vi.fn>;
  };
  cryptoService: { [K in keyof CryptoService]: ReturnType<typeof vi.fn> };
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
      findByMoltbookName: vi.fn(),
      findByIdentityId: vi.fn(),
      upsert: vi.fn(),
    },
    cryptoService: {
      sign: vi.fn(),
      verify: vi.fn(),
      parsePublicKey: vi.fn(),
    },
  };
}

export function createMockDeps(
  mocks: MockServices,
  auth: AuthContext | null = VALID_AUTH,
): McpDeps {
  return {
    diaryService: mocks.diaryService as unknown as DiaryService,
    agentRepository: mocks.agentRepository as unknown as AgentRepository,
    cryptoService: mocks.cryptoService as unknown as CryptoService,
    getAuthContext: () => auth,
  };
}

/**
 * Helper to extract text content from a CallToolResult.
 */
export function getTextContent(result: {
  content: { type: string; text?: string }[];
}): string {
  const textItem = result.content.find((c) => c.type === 'text');
  return textItem?.text ?? '';
}

/**
 * Helper to parse JSON text content from a CallToolResult.
 */
export function parseResult<T = unknown>(result: {
  content: { type: string; text?: string }[];
}): T {
  return JSON.parse(getTextContent(result)) as T;
}
