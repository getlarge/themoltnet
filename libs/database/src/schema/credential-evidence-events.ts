import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  smallint,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Append-only audit trail for credential-ladder issuance and denial decisions.
 *
 * One row per `CredentialEvidenceEvent` (`MoltNetCredentialEvidenceEventV1` in
 * `@themoltnet/credentials`). That contract is closed and secret-free, so there
 * is deliberately no token column: a credential is identified only by its `jti`
 * and signing `kid`.
 *
 * Two properties are load-bearing:
 *
 * - **No foreign keys.** Deleting an agent, task, or grant must neither erase
 *   nor block the audit record of what was authorized. Retention pruning of
 *   tasks must not cascade into evidence.
 * - **Append-only.** Rows are never updated (enforced by a BEFORE UPDATE
 *   trigger; see `0039_credential_evidence_immutability.sql`). DELETE stays
 *   available so the retention policy can prune by `occurred_at`.
 */
export const credentialEvidenceEvents = pgTable(
  'credential_evidence_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Credential contract version the event was emitted under. */
    version: smallint('version').notNull(),
    event: varchar('event', { length: 64 }).notNull(),
    /** Broker clock reading for the decision itself. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    outcome: varchar('outcome', { length: 8 }).notNull(),
    /** Low-cardinality slug from the broker's closed reason set. */
    reason: varchar('reason', { length: 255 }).notNull(),
    agentId: uuid('agent_id'),
    teamId: uuid('team_id'),
    taskId: uuid('task_id'),
    attemptN: integer('attempt_n'),
    connectorId: varchar('connector_id', { length: 255 }),
    operation: varchar('operation', { length: 255 }),
    resourceId: varchar('resource_id', { length: 255 }),
    grantId: uuid('grant_id'),
    grantRevision: integer('grant_revision'),
    credentialJti: varchar('credential_jti', { length: 255 }),
    credentialKid: varchar('credential_kid', { length: 255 }),
    /** Server clock reading at persistence — the audit trust anchor. */
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('credential_evidence_events_attempt_idx').on(
      table.taskId,
      table.attemptN,
    ),
    index('credential_evidence_events_occurred_at_idx').on(table.occurredAt),
    // Incident response starts from a credential seen in the wild.
    index('credential_evidence_events_jti_idx')
      .on(table.credentialJti)
      .where(sql`credential_jti IS NOT NULL`),
    check(
      'credential_evidence_events_outcome',
      sql`${table.outcome} IN ('allow', 'deny')`,
    ),
  ],
);

export type CredentialEvidenceEventRecord =
  typeof credentialEvidenceEvents.$inferSelect;
export type NewCredentialEvidenceEventRecord =
  typeof credentialEvidenceEvents.$inferInsert;
