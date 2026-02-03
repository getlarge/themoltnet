/**
 * MoltNet Database Schema
 *
 * Using Drizzle ORM with PostgreSQL + pgvector
 * Database: Supabase (https://dlvifjrhhivjwfkivjgr.supabase.co)
 */

import {
  index,
  pgEnum,
  pgTable,
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
    // Parse PostgreSQL vector format: [0.1,0.2,...]
    return JSON.parse(
      value.replace(/^\[/, '[').replace(/\]$/, ']'),
    ) as number[];
  },
});

// Visibility enum
export const visibilityEnum = pgEnum('visibility', [
  'private',
  'moltnet',
  'public',
]);

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

    // Entry content
    title: varchar('title', { length: 255 }),
    content: text('content').notNull(),

    // Vector embedding for semantic search (e5-small-v2: 384 dimensions)
    embedding: vector('embedding'),

    // Visibility level
    visibility: visibilityEnum('visibility').default('private').notNull(),

    // Metadata
    tags: text('tags').array(),

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

    // Index for visibility filtering
    visibilityIdx: index('diary_entries_visibility_idx').on(table.visibility),

    // Composite index for owner + created_at (common query pattern)
    ownerCreatedIdx: index('diary_entries_owner_created_idx').on(
      table.ownerId,
      table.createdAt,
    ),

    // Full-text search index (created via raw SQL in migration)
    // Will add: CREATE INDEX diary_entries_content_fts_idx ON diary_entries USING gin(to_tsvector('english', content));

    // HNSW index for vector similarity (created via raw SQL in migration)
    // Will add: CREATE INDEX diary_entries_embedding_idx ON diary_entries USING hnsw (embedding vector_cosine_ops);
  }),
);

/**
 * Entry Shares Table
 *
 * Tracks explicit sharing of entries between agents
 */
export const entryShares = pgTable(
  'entry_shares',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // The shared entry
    entryId: uuid('entry_id')
      .notNull()
      .references(() => diaryEntries.id, { onDelete: 'cascade' }),

    // Who shared it (Ory Kratos identity ID)
    sharedBy: uuid('shared_by').notNull(),

    // Who it's shared with (Ory Kratos identity ID)
    sharedWith: uuid('shared_with').notNull(),

    // When it was shared
    sharedAt: timestamp('shared_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    // Unique constraint: can only share an entry with someone once
    uniqueShare: uniqueIndex('entry_shares_unique_idx').on(
      table.entryId,
      table.sharedWith,
    ),

    // Index for finding entries shared with a specific agent
    sharedWithIdx: index('entry_shares_shared_with_idx').on(table.sharedWith),

    // Index for finding entries shared by a specific agent
    sharedByIdx: index('entry_shares_shared_by_idx').on(table.sharedBy),
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

// Type exports for use in services
export type DiaryEntry = typeof diaryEntries.$inferSelect;
export type NewDiaryEntry = typeof diaryEntries.$inferInsert;
export type EntryShare = typeof entryShares.$inferSelect;
export type NewEntryShare = typeof entryShares.$inferInsert;
export type AgentKey = typeof agentKeys.$inferSelect;
export type NewAgentKey = typeof agentKeys.$inferInsert;
export type AgentVoucher = typeof agentVouchers.$inferSelect;
export type NewAgentVoucher = typeof agentVouchers.$inferInsert;
