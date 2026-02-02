/**
 * E2E Test Setup
 *
 * Bootstraps the REST API with real services (database, diary, crypto)
 * and a mocked auth layer (bypasses Ory token validation + Keto permissions).
 *
 * Requires: PostgreSQL running via `pnpm run docker:up` (app-db on port 5433)
 */

import type {
  AuthContext,
  OryClients,
  PermissionChecker,
  TokenValidator,
} from '@moltnet/auth';
import { cryptoService, type KeyPair } from '@moltnet/crypto-service';
import {
  createAgentRepository,
  createDatabase,
  createDiaryRepository,
  type Database,
} from '@moltnet/database';
import {
  createDiaryService,
  createNoopEmbeddingService,
} from '@moltnet/diary-service';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';

// ── Constants ────────────────────────────────────────────────

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://moltnet:moltnet_secret@localhost:5433/moltnet';

const WEBHOOK_API_KEY = 'e2e-test-webhook-key';

export const AGENT_A_ID = '00000000-0000-4000-a000-000000000001';
export const AGENT_B_ID = '00000000-0000-4000-a000-000000000002';

// ── Auth Context Factory ─────────────────────────────────────

export function createAuthContext(
  overrides: Partial<AuthContext> = {},
): AuthContext {
  return {
    identityId: AGENT_A_ID,
    moltbookName: 'TestAgent',
    publicKey: 'ed25519:AAAA',
    fingerprint: 'A1B2-C3D4-E5F6-07A8',
    clientId: 'e2e-test-client',
    scopes: ['diary:read', 'diary:write', 'agent:profile'],
    ...overrides,
  };
}

// ── Permissive Permission Checker (no Keto needed) ───────────

function createPermissivePermissionChecker(): PermissionChecker {
  return {
    canViewEntry: async () => true,
    canEditEntry: async () => true,
    canDeleteEntry: async () => true,
    canShareEntry: async () => true,
    grantOwnership: async () => {},
    grantViewer: async () => {},
    revokeViewer: async () => {},
    registerAgent: async () => {},
    removeEntryRelations: async () => {},
  };
}

// ── Token Validator (bypasses Ory Hydra) ─────────────────────

function createTestTokenValidator(authContext: AuthContext): TokenValidator {
  return {
    introspect: async () => ({
      active: true,
      clientId: authContext.clientId,
      scopes: authContext.scopes,
      ext: {},
    }),
    resolveAuthContext: async (token: string) => {
      if (!token || token === 'invalid') return null;
      return authContext;
    },
  };
}

// ── Test Harness ─────────────────────────────────────────────

export interface TestHarness {
  app: FastifyInstance;
  db: Database;
  baseUrl: string;
  authContext: AuthContext;
  keyPair: KeyPair;
  /** Truncate all application tables */
  cleanup(): Promise<void>;
  /** Close server and database */
  teardown(): Promise<void>;
}

export async function createTestHarness(
  authContextOverrides?: Partial<AuthContext>,
): Promise<TestHarness> {
  const db = createDatabase(DATABASE_URL);

  // Ensure tables exist by running key DDL statements
  await ensureSchema(db);

  const keyPair = await cryptoService.generateKeyPair();

  const authContext = createAuthContext({
    publicKey: keyPair.publicKey,
    fingerprint: keyPair.fingerprint,
    ...authContextOverrides,
  });

  const diaryRepository = createDiaryRepository(db);
  const agentRepository = createAgentRepository(db);
  const embeddingService = createNoopEmbeddingService();
  const permissionChecker = createPermissivePermissionChecker();

  const diaryService = createDiaryService({
    diaryRepository,
    permissionChecker,
    embeddingService,
  });

  const tokenValidator = createTestTokenValidator(authContext);

  const mockOryClients: OryClients = {
    frontend: {} as OryClients['frontend'],
    identity: {} as OryClients['identity'],
    oauth2: {
      getOAuth2Client: async () => ({
        data: { client_id: authContext.clientId, metadata: {} },
      }),
    } as unknown as OryClients['oauth2'],
    permission: {} as OryClients['permission'],
    relationship: {} as OryClients['relationship'],
  };

  const app = await buildApp({
    diaryService,
    agentRepository,
    cryptoService,
    permissionChecker,
    tokenValidator,
    webhookApiKey: WEBHOOK_API_KEY,
    oryClients: mockOryClients,
  });

  // Start on random port
  const address = await app.listen({ port: 0, host: '127.0.0.1' });

  async function cleanup() {
    await db.execute(sql`DELETE FROM entry_shares`);
    await db.execute(sql`DELETE FROM diary_entries`);
    await db.execute(sql`DELETE FROM agent_keys`);
  }

  async function teardown() {
    await cleanup();
    await app.close();
  }

  return {
    app,
    db,
    baseUrl: address,
    authContext,
    keyPair,
    cleanup,
    teardown,
  };
}

// ── Schema Bootstrap ─────────────────────────────────────────

async function ensureSchema(db: Database): Promise<void> {
  // Check if tables already exist (idempotent)
  try {
    await db.execute(sql`SELECT 1 FROM diary_entries LIMIT 0`);
    return; // Tables exist, no need to create
  } catch {
    // Tables don't exist, create them
  }

  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await db.execute(
    sql`DO $$ BEGIN CREATE TYPE visibility AS ENUM ('private', 'moltnet', 'public'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  );
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS diary_entries (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      owner_id UUID NOT NULL,
      title VARCHAR(255),
      content TEXT NOT NULL,
      embedding vector(384),
      visibility visibility NOT NULL DEFAULT 'private',
      tags TEXT[],
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS entry_shares (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      entry_id UUID NOT NULL REFERENCES diary_entries(id) ON DELETE CASCADE,
      shared_by UUID NOT NULL,
      shared_with UUID NOT NULL,
      shared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(entry_id, shared_with)
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_keys (
      identity_id UUID PRIMARY KEY,
      moltbook_name VARCHAR(100) NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      fingerprint VARCHAR(19) NOT NULL UNIQUE,
      moltbook_verified TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * Check if PostgreSQL is reachable. Use in test files to skip
 * gracefully when Docker infrastructure isn't running.
 */
export async function isDatabaseAvailable(): Promise<boolean> {
  try {
    const db = createDatabase(DATABASE_URL);
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}
