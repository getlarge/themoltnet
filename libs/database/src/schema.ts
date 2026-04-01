/**
 * MoltNet Database Schema
 *
 * Using Drizzle ORM with PostgreSQL + pgvector
 * Database: Supabase (https://dlvifjrhhivjwfkivjgr.supabase.co)
 */

import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
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

// Entry relation enum for associative memory graph
export const relationTypeEnum = pgEnum('relation_type', [
  'supersedes',
  'elaborates',
  'contradicts',
  'supports',
  'caused_by',
  'references',
]);

// Relation lifecycle status (automated proposals vs accepted links)
export const relationStatusEnum = pgEnum('relation_status', [
  'proposed',
  'accepted',
  'rejected',
]);

// Compression level used when an entry is materialized into a context pack
export const compressionLevelEnum = pgEnum('compression_level', [
  'full',
  'summary',
  'keywords',
]);

// Pack type discriminator — determines the shape of the params JSONB column.
// compile: server-generated via /compile endpoint
// optimized: GEPA-refined version of a compile pack
// custom: agent-submitted with opaque params
export const packTypeEnum = pgEnum('pack_type', [
  'compile',
  'optimized',
  'custom',
]);

// Team status enum — founding requires acceptance, active is operational
export const teamStatusEnum = pgEnum('team_status', [
  'founding',
  'active',
  'archived',
]);

// Team invite role enum — can't invite as owner (ownership transfer is separate)
export const teamInviteRoleEnum = pgEnum('team_invite_role', [
  'manager',
  'member',
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
    // Legacy: will be renamed to created_by once all diaries are team-scoped
    ownerId: uuid('owner_id').notNull(),

    // Team that governs access to this diary (Option A: nullable during migration)
    teamId: uuid('team_id').references((): AnyPgColumn => teams.id, {
      onDelete: 'set null',
    }),

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
    teamIdx: index('diaries_team_idx').on(table.teamId),
  }),
);

/**
 * Diary Entries Table
 *
 * Stores agent diary entries with embeddings for semantic search.
 * Owner and visibility are inherited from the parent diary — not stored here.
 */
export const diaryEntries = pgTable(
  'diary_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // Diary collection container (owner and visibility inherited from here)
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

    // Metadata
    tags: text('tags').array(),
    // Strong provenance: authenticated principal that created the entry.
    createdBy: uuid('created_by').notNull(),

    // Prompt injection risk flag (set by vard scanner)
    injectionRisk: boolean('injection_risk').default(false).notNull(),

    // Memory system fields
    importance: smallint('importance').default(5).notNull(),
    accessCount: integer('access_count').default(0).notNull(),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
    entryType: entryTypeEnum('entry_type').default('semantic').notNull(),
    // Content signing (CIDv1 + Ed25519 signature)
    contentHash: varchar('content_hash', { length: 100 }),
    contentSignature: text('content_signature'),
    signingNonce: uuid('signing_nonce'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    diaryIdx: index('diary_entries_diary_idx').on(table.diaryId),
    createdByIdx: index('diary_entries_created_by_idx').on(table.createdBy),

    // Index for entry type filtering (memory system)
    entryTypeIdx: index('diary_entries_entry_type_idx').on(table.entryType),

    // Each content signature can only be used once (prevents signing request reuse)
    contentSignatureIdx: uniqueIndex(
      'diary_entries_content_signature_unique_idx',
    )
      .on(table.contentSignature)
      .where(sql`content_signature IS NOT NULL`),

    // Fast CID lookup for provenance and DAG materialization.
    contentHashIdx: index('diary_entries_content_hash_idx')
      .on(table.contentHash)
      .where(sql`content_hash IS NOT NULL`),

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

/**
 * Entry Relations Table
 *
 * Typed graph edges between diary entries. Provides a non-linear associative
 * memory structure, including supersession tracking via the 'supersedes' relation.
 */
export const entryRelations = pgTable(
  'entry_relations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => diaryEntries.id, { onDelete: 'cascade' }),
    targetId: uuid('target_id')
      .notNull()
      .references(() => diaryEntries.id, { onDelete: 'cascade' }),
    relation: relationTypeEnum('relation').notNull(),
    status: relationStatusEnum('status').default('proposed').notNull(),
    // Snapshot CIDs for audit/drift checks when entries are mutable.
    sourceCidSnapshot: varchar('source_cid_snapshot', { length: 100 }),
    targetCidSnapshot: varchar('target_cid_snapshot', { length: 100 }),
    // Workflow + confidence/similarity metadata for review and ranking.
    workflowId: text('workflow_id'),
    metadata: jsonb('metadata')
      .default(sql`'{}'::jsonb`)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    uniqueRelation: uniqueIndex('entry_relations_unique_idx').on(
      table.sourceId,
      table.targetId,
      table.relation,
    ),
    sourceIdx: index('entry_relations_source_idx').on(table.sourceId),
    targetIdx: index('entry_relations_target_idx').on(table.targetId),
    relationIdx: index('entry_relations_type_idx').on(table.relation),
    statusIdx: index('entry_relations_status_idx').on(table.status),
  }),
);

/**
 * Context Packs Table
 *
 * Materialized compile/optimized/custom outputs. A pack has a CID root,
 * typed params, retention policy, and optional supersession pointer.
 *
 * packType discriminates the params JSONB shape:
 * - compile: { tokenBudget, lambda?, taskPromptHash?, wRecency?, wImportance? }
 * - optimized: { sourcePackCid, gepaTrials, gepaScore, teacherModel?, studentModel? }
 * - custom: agent-defined (opaque JSONB, validated as object only)
 */
export const contextPacks = pgTable(
  'context_packs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    diaryId: uuid('diary_id')
      .notNull()
      .references(() => diaries.id, { onDelete: 'cascade' }),
    packCid: varchar('pack_cid', { length: 100 }).notNull(),
    packCodec: varchar('pack_codec', { length: 50 })
      .default('dag-cbor')
      .notNull(),
    packType: packTypeEnum('pack_type').default('compile').notNull(),
    // Type-specific parameters. Shape determined by packType.
    // Validated at the service layer, not the DB layer.
    params: jsonb('params')
      .default(sql`'{}'::jsonb`)
      .notNull(),
    // JSON mirror of DAG-CBOR envelope for direct SQL/web inspection.
    payload: jsonb('payload')
      .default(sql`'{}'::jsonb`)
      .notNull(),
    // Strong provenance: authenticated principal that materialized the pack.
    createdBy: uuid('created_by').notNull(),
    supersedesPackId: uuid('supersedes_pack_id').references(
      (): AnyPgColumn => contextPacks.id,
    ),
    pinned: boolean('pinned').default(false).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).default(
      sql`(now() + interval '7 days')`,
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    packCidUniqueIdx: uniqueIndex('context_packs_pack_cid_unique_idx').on(
      table.packCid,
    ),
    diaryIdx: index('context_packs_diary_idx').on(table.diaryId),
    packTypeIdx: index('context_packs_pack_type_idx').on(table.packType),
    expiresAtIdx: index('context_packs_expires_at_idx')
      .on(table.expiresAt)
      .where(sql`pinned = false`),
    pinnedIdx: index('context_packs_pinned_idx').on(table.pinned),
  }),
);

/**
 * Context Pack Entries Table
 *
 * Membership rows for pack -> entry links with pack-specific ranking and
 * compression metadata.
 */
export const contextPackEntries = pgTable(
  'context_pack_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    packId: uuid('pack_id')
      .notNull()
      .references(() => contextPacks.id, { onDelete: 'cascade' }),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => diaryEntries.id, { onDelete: 'cascade' }),
    entryCidSnapshot: varchar('entry_cid_snapshot', { length: 100 }).notNull(),
    compressionLevel: compressionLevelEnum('compression_level')
      .default('full')
      .notNull(),
    originalTokens: integer('original_tokens'),
    packedTokens: integer('packed_tokens'),
    rank: integer('rank'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    uniquePackEntry: uniqueIndex('context_pack_entries_unique_idx').on(
      table.packId,
      table.entryId,
    ),
    packIdx: index('context_pack_entries_pack_idx').on(table.packId),
    entryIdx: index('context_pack_entries_entry_idx').on(table.entryId),
  }),
);

/**
 * Teams Table
 *
 * Groups agents (and eventually humans) under shared resource ownership.
 * Every subject gets a personal team at registration.
 * Membership is stored in Keto (Team:id#role@Subject:id), not in a DB table.
 */
export const teams = pgTable(
  'teams',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    name: varchar('name', { length: 255 }).notNull(),

    // founding: awaiting owner acceptance, active: operational, archived: soft-deleted
    status: teamStatusEnum('status').default('active').notNull(),

    // Auto-created personal team (1 owner, no invites, no additional members)
    personal: boolean('personal').default(false).notNull(),

    createdBy: uuid('created_by').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    createdByIdx: index('teams_created_by_idx').on(table.createdBy),
  }),
);

/**
 * Groups Table
 *
 * Named subsets of team members for fine-grained diary grants.
 * Membership is stored in Keto (Group:id#members@Subject:id), not in a DB table.
 */
export const groups = pgTable(
  'groups',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    name: varchar('name', { length: 255 }).notNull(),

    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),

    createdBy: uuid('created_by').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    teamIdx: index('groups_team_idx').on(table.teamId),
    nameTeamIdx: uniqueIndex('groups_name_team_idx').on(
      table.name,
      table.teamId,
    ),
  }),
);

/**
 * Team Invites Table
 *
 * Code-based invitations for joining teams.
 * Same pattern as agent vouchers — no email required.
 */
export const teamInvites = pgTable(
  'team_invites',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),

    // Prefixed code: mlt_inv_...
    code: varchar('code', { length: 64 }).notNull(),

    // Can't invite as owner — ownership transfer is a separate operation
    role: teamInviteRoleEnum('role').default('member').notNull(),

    maxUses: integer('max_uses').default(1).notNull(),
    useCount: integer('use_count').default(0).notNull(),

    createdBy: uuid('created_by').notNull(),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    codeIdx: uniqueIndex('team_invites_code_idx').on(table.code),
    teamIdx: index('team_invites_team_idx').on(table.teamId),
  }),
);

/**
 * Rendered Packs Table
 *
 * Immutable, CID-addressed rendered versions of context packs. Each row
 * stores the rendered markdown content and its DAG-CBOR CID. Append-only:
 * re-rendering creates a new row (new CID), not an upsert.
 *
 * Uses the same pinned + expiresAt GC pattern as context_packs.
 * ON DELETE CASCADE from source_pack_id cleans up when the source is GC'd.
 */
export const renderedPacks = pgTable(
  'rendered_packs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    packCid: varchar('pack_cid', { length: 100 }).notNull(),
    sourcePackId: uuid('source_pack_id')
      .notNull()
      .references(() => contextPacks.id, { onDelete: 'cascade' }),
    diaryId: uuid('diary_id')
      .notNull()
      .references(() => diaries.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    contentHash: varchar('content_hash', { length: 100 }).notNull(),
    renderMethod: varchar('render_method', { length: 100 }).notNull(),
    totalTokens: integer('total_tokens').notNull(),
    createdBy: uuid('created_by').notNull(),
    pinned: boolean('pinned').default(false).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).default(
      sql`(now() + interval '7 days')`,
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    packCidUniqueIdx: uniqueIndex('rendered_packs_pack_cid_unique_idx').on(
      table.packCid,
    ),
    sourcePackIdx: index('rendered_packs_source_pack_idx').on(
      table.sourcePackId,
    ),
    diaryIdx: index('rendered_packs_diary_idx').on(table.diaryId),
    expiresAtIdx: index('rendered_packs_expires_at_idx')
      .on(table.expiresAt)
      .where(sql`pinned = false`),
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
export type EntryRelation = typeof entryRelations.$inferSelect;
export type NewEntryRelation = typeof entryRelations.$inferInsert;
export type ContextPack = typeof contextPacks.$inferSelect;
export type NewContextPack = typeof contextPacks.$inferInsert;
export type ContextPackEntry = typeof contextPackEntries.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type TeamInvite = typeof teamInvites.$inferSelect;
export type NewTeamInvite = typeof teamInvites.$inferInsert;

export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type NewContextPackEntry = typeof contextPackEntries.$inferInsert;
export type RenderedPack = typeof renderedPacks.$inferSelect;
export type NewRenderedPack = typeof renderedPacks.$inferInsert;

// ── Rendered Pack Verifications ────────────────────────────

export const renderedPackVerifications = pgTable(
  'rendered_pack_verifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    renderedPackId: uuid('rendered_pack_id')
      .notNull()
      .references(() => renderedPacks.id, { onDelete: 'cascade' }),
    nonce: uuid('nonce').notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    claimedBy: uuid('claimed_by'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    renderedPackIdx: index('verifications_rendered_pack_idx').on(
      table.renderedPackId,
    ),
    statusIdx: index('verifications_status_idx').on(table.status),
    expiresAtIdx: index('verifications_expires_at_idx').on(table.expiresAt),
    nonceUniqueIdx: uniqueIndex('verifications_nonce_unique_idx').on(
      table.nonce,
    ),
  }),
);

export type RenderedPackVerification =
  typeof renderedPackVerifications.$inferSelect;
export type NewRenderedPackVerification =
  typeof renderedPackVerifications.$inferInsert;

// ── Rendered Pack Attestations ─────────────────────────────

export const renderedPackAttestations = pgTable(
  'rendered_pack_attestations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    renderedPackId: uuid('rendered_pack_id')
      .notNull()
      .references(() => renderedPacks.id, { onDelete: 'cascade' }),
    coverage: real('coverage').notNull(),
    grounding: real('grounding').notNull(),
    faithfulness: real('faithfulness').notNull(),
    composite: real('composite').notNull(),
    judgeModel: varchar('judge_model', { length: 100 }).notNull(),
    judgeProvider: varchar('judge_provider', { length: 50 }).notNull(),
    judgeBinaryCid: varchar('judge_binary_cid', { length: 100 }).notNull(),
    rubricCid: varchar('rubric_cid', { length: 100 }),
    createdBy: uuid('created_by').notNull(),
    transcript: text('transcript').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    renderedPackIdx: index('attestations_rendered_pack_idx').on(
      table.renderedPackId,
    ),
    compositeIdx: index('attestations_composite_idx').on(table.composite),
  }),
);

export type RenderedPackAttestation =
  typeof renderedPackAttestations.$inferSelect;
export type NewRenderedPackAttestation =
  typeof renderedPackAttestations.$inferInsert;
