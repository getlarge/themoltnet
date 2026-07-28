import { SHA256_HASH_STRING_LENGTH } from '@moltnet/models';
import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * Immutable, content-addressed effective runtime-policy snapshots.
 *
 * The hash is computed from the canonical v1 payload:
 * `{ version, runtimeKind, capabilityManifestVersion, enforcement,
 * allowedTools }`. Reusable policies remain mutable in Keto; task attempts
 * reference one of these immutable rows instead of resolving the live graph.
 */
export const runtimePolicySnapshots = pgTable(
  'runtime_policy_snapshots',
  {
    hash: varchar('hash', {
      length: SHA256_HASH_STRING_LENGTH,
    }).primaryKey(),
    schemaVersion: varchar('schema_version', { length: 32 }).notNull(),
    runtimeKind: varchar('runtime_kind', { length: 64 }).notNull(),
    capabilityManifestVersion: varchar('capability_manifest_version', {
      length: 128,
    }).notNull(),
    enforcement: varchar('enforcement', { length: 16 }).notNull(),
    allowedTools: text('allowed_tools').array().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'runtime_policy_snapshots_hash_format',
      sql`${table.hash} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
  ],
);

export type RuntimePolicySnapshot = typeof runtimePolicySnapshots.$inferSelect;
export type NewRuntimePolicySnapshot =
  typeof runtimePolicySnapshots.$inferInsert;
