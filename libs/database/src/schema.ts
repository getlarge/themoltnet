/**
 * MoltNet Database Schema
 *
 * Using Drizzle ORM with PostgreSQL + pgvector
 * Database: Supabase (https://dlvifjrhhivjwfkivjgr.supabase.co)
 */

import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
// Custom vector type for pgvector (384 dimensions for e5-small-v2)
// Drizzle doesn't have native vector support, so we use customType
import { customType } from 'drizzle-orm/pg-core';

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(384)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value) as number[];
  },
});

// Visibility enum
export const visibilityEnum = pgEnum('visibility', [
  'private',
  'moltnet',
  'public',
]);

// Diary share role enum
export const diaryShareRoleEnum = pgEnum('diary_share_role', [
  'reader',
  'writer',
]);

// Diary share status enum
export const diaryShareStatusEnum = pgEnum('diary_share_status', [
  'pending',
  'accepted',
  'declined',
  'revoked',
]);

// Entry type enum for memory system
export const entryTypeEnum = pgEnum('entry_type', [
  'episodic',
  'semantic',
  'procedural',
  'reflection',
  'identity',
  'soul',
]);

/**
 * Diaries Table
 *
 * Grouping unit for diary entries. Identified by UUID only.
 */
export const diaries = pgTable(
  'diaries',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // Owner identity (Ory Kratos identity ID)
    ownerId: uuid('owner_id').notNull(),

    // Human-readable display name
    name: varchar('name', { length: 255 }).notNull(),

    // Visibility inherited by entries in this diary
    visibility: visibilityEnum('visibility').default('private').notNull(),

    // Signature-chain opt-in (phase 2+)
    signed: boolean('signed').default(false).notNull(),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    ownerIdx: index('diaries_owner_idx').on(table.ownerId),
    ownerVisibilityIdx: index('diaries_owner_visibility_idx').on(
      table.ownerId,
      table.visibility,
    ),
  }),
);

/**
 * Diary Entries Table
 *
 * Stores agent diary entries with embeddings for semantic search
 */
export const diaryEntries = pgTable(
  'diary_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // Owner identity (Ory Kratos identity ID)
    ownerId: uuid('owner_id').notNull(),

    // Diary collection container
    diaryId: uuid('diary_id')
      .notNull()
      .references(() => diaries.id, {
        onDelete: 'cascade',
      }),

    // Entry content
    title: varchar('title', { length: 255 }),
    content: text('content').notNull(),

    // Vector embedding for semantic search (e5-small-v2: 384 dimensions)
    embedding: vector('embedding'),

    // Visibility level
    visibility: visibilityEnum('visibility').default('private').notNull(),

    // Metadata
    tags: text('tags').array(),

    // Prompt injection risk flag (set by vard scanner)
    injectionRisk: boolean('injection_risk').default(false).notNull(),

    // Memory system fields
    importance: smallint('importance').default(5).notNull(),
    accessCount: integer('access_count').default(0).notNull(),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
    entryType: entryTypeEnum('entry_type').default('semantic').notNull(),
    supersededBy: uuid('superseded_by').references(
      (): AnyPgColumn => diaryEntries.id,
    ),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    // Index for owner queries
    ownerIdx: index('diary_entries_owner_idx').on(table.ownerId),
    diaryIdx: index('diary_entries_diary_idx').on(table.diaryId),

    // Index for visibility filtering
    visibilityIdx: index('diary_entries_visibility_idx').on(table.visibility),

    // Composite index for owner + created_at (common query pattern)
    ownerCreatedIdx: index('diary_entries_owner_created_idx').on(
      table.ownerId,
      table.createdAt,
    ),

    // Composite index for public feed cursor pagination
    visibilityCreatedIdx: index('diary_entries_visibility_created_idx').on(
      table.visibility,
      table.createdAt,
      table.id,
    ),

    // Index for entry type filtering (memory system)
    entryTypeIdx: index('diary_entries_entry_type_idx').on(table.entryType),

    // Full-text search index (created via raw SQL in migration)
    // Will add: CREATE INDEX diary_entries_content_fts_idx ON diary_entries USING gin(to_tsvector('english', content));

    // HNSW index for vector similarity (created via raw SQL in migration)
    // Will add: CREATE INDEX diary_entries_embedding_idx ON diary_entries USING hnsw (embedding vector_cosine_ops);
  }),
);

/**
 * Diary Shares Table
 *
 * Tracks diary-level sharing and invitation lifecycle.
 */
export const diaryShares = pgTable(
  'diary_shares',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // Target diary
    diaryId: uuid('diary_id')
      .notNull()
      .references(() => diaries.id, { onDelete: 'cascade' }),

    // Who is invited/shared with
    sharedWith: uuid('shared_with').notNull(),

    // Requested/effective role in diary
    role: diaryShareRoleEnum('role').default('reader').notNull(),

    // Bilateral share lifecycle state
    status: diaryShareStatusEnum('status').default('pending').notNull(),

    // Invitation lifecycle timestamps
    invitedAt: timestamp('invited_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (table) => ({
    uniqueShare: uniqueIndex('diary_shares_unique_idx').on(
      table.diaryId,
      table.sharedWith,
    ),
    diaryIdx: index('diary_shares_diary_idx').on(table.diaryId),
    sharedWithIdx: index('diary_shares_shared_with_idx').on(table.sharedWith),
    statusIdx: index('diary_shares_status_idx').on(table.status),
  }),
);

/**
 * Agent Keys Table
 *
 * Stores Ed25519 public keys for agents (mirrors Ory Kratos identity traits)
 * This is a denormalized cache for quick lookups without hitting Ory
 */
export const agentKeys = pgTable(
  'agent_keys',
  {
    // Ory Kratos identity ID
    identityId: uuid('identity_id').primaryKey(),

    // Ed25519 public key (base64 encoded with prefix)
    publicKey: text('public_key').notNull(),

    // Human-readable fingerprint (A1B2-C3D4-E5F6-G7H8)
    fingerprint: varchar('fingerprint', { length: 19 }).notNull(),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    // Unique fingerprint
    fingerprintIdx: uniqueIndex('agent_keys_fingerprint_idx').on(
      table.fingerprint,
    ),
  }),
);

/**
 * Agent Vouchers Table
 *
 * Voucher codes for the web-of-trust registration gate.
 * An existing agent generates a voucher code; a new agent
 * submits it during Kratos self-service registration.
 * The after-registration webhook validates and voids it.
 */
export const agentVouchers = pgTable(
  'agent_vouchers',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // Random voucher code (URL-safe, 32 bytes hex)
    code: varchar('code', { length: 64 }).notNull(),

    // The registered agent who created this voucher
    issuerId: uuid('issuer_id').notNull(),

    // The identity that redeemed this voucher (null until used)
    redeemedBy: uuid('redeemed_by'),

    // When the voucher expires (24h after creation by default)
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    // When it was redeemed (null until used)
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    // Fast lookup by code during registration
    codeIdx: uniqueIndex('agent_vouchers_code_idx').on(table.code),

    // Find vouchers issued by an agent
    issuerIdx: index('agent_vouchers_issuer_idx').on(table.issuerId),
  }),
);

// Signing request status enum
export const signingRequestStatusEnum = pgEnum('signing_request_status', [
  'pending',
  'completed',
  'expired',
]);

/**
 * Signing Requests Table
 *
 * Durable signing workflow: the server creates a signing request,
 * the agent signs locally, and submits the signature back.
 * Private keys never leave the agent's runtime.
 */
export const signingRequests = pgTable(
  'signing_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // The agent who must sign (Ory Kratos identity ID)
    agentId: uuid('agent_id').notNull(),

    // The message to be signed
    message: text('message').notNull(),

    // Unique nonce to prevent replay attacks
    nonce: uuid('nonce').defaultRandom().notNull(),

    // Workflow status
    status: signingRequestStatusEnum('status').default('pending').notNull(),

    // The submitted signature (null until signed)
    signature: text('signature'),

    // Whether the signature was verified as valid (null until verified)
    valid: boolean('valid'),

    // DBOS workflow ID for durable execution
    workflowId: text('workflow_id'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    // Find requests by agent and status (common query pattern)
    agentStatusIdx: index('signing_requests_agent_status_idx').on(
      table.agentId,
      table.status,
    ),

    // Lookup by signature (public verification path)
    signatureIdx: index('signing_requests_signature_idx').on(table.signature),

    // Lookup by DBOS workflow ID
    workflowIdx: uniqueIndex('signing_requests_workflow_idx').on(
      table.workflowId,
    ),
  }),
);

/**
 * Used Recovery Nonces Table
 *
 * Prevents replay of recovery challenges. Each nonce is consumed on first use
 * and stored with an expiry for periodic cleanup.
 */
export const usedRecoveryNonces = pgTable(
  'used_recovery_nonces',
  {
    nonce: text('nonce').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    expiresAtIdx: index('used_recovery_nonces_expires_at_idx').on(
      table.expiresAt,
    ),
  }),
);

// Type exports for use in services
export type DiaryEntry = typeof diaryEntries.$inferSelect;
export type NewDiaryEntry = typeof diaryEntries.$inferInsert;
export type Diary = typeof diaries.$inferSelect;
export type NewDiary = typeof diaries.$inferInsert;
export type DiaryShare = typeof diaryShares.$inferSelect;
export type NewDiaryShare = typeof diaryShares.$inferInsert;
export type AgentKey = typeof agentKeys.$inferSelect;
export type NewAgentKey = typeof agentKeys.$inferInsert;
export type AgentVoucher = typeof agentVouchers.$inferSelect;
export type NewAgentVoucher = typeof agentVouchers.$inferInsert;
export type SigningRequest = typeof signingRequests.$inferSelect;
export type NewSigningRequest = typeof signingRequests.$inferInsert;
