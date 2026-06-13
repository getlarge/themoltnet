import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { PgEnum } from 'drizzle-orm/pg-core/columns/enum';

interface DaemonProfileSchemaDeps {
  agents: { identityId: AnyPgColumn };
  humans: { id: AnyPgColumn };
  teams: { id: AnyPgColumn };
  runtimeKindEnum: PgEnum<['gondolin_pi']>;
  storageModeEnum: PgEnum<['local']>;
}

export function defineDaemonProfilesTable({
  agents,
  humans,
  teams,
  runtimeKindEnum,
  storageModeEnum,
}: DaemonProfileSchemaDeps) {
  return pgTable(
    'daemon_profiles',
    {
      id: uuid('id').defaultRandom().primaryKey(),
      teamId: uuid('team_id')
        .notNull()
        .references(() => teams.id, { onDelete: 'restrict' }),
      name: varchar('name', { length: 100 }).notNull(),
      description: text('description'),
      provider: varchar('provider', { length: 100 }).notNull(),
      model: varchar('model', { length: 200 }).notNull(),
      runtimeKind: runtimeKindEnum('runtime_kind')
        .notNull()
        .default('gondolin_pi'),
      sandbox: jsonb('sandbox').notNull(),
      sessionStorageMode: storageModeEnum('session_storage_mode')
        .notNull()
        .default('local'),
      workspaceStorageMode: storageModeEnum('workspace_storage_mode')
        .notNull()
        .default('local'),
      sessionTtlSec: integer('session_ttl_sec').notNull().default(1800),
      workspaceTtlSec: integer('workspace_ttl_sec').notNull().default(1800),
      leaseTtlSec: integer('lease_ttl_sec').notNull().default(300),
      heartbeatIntervalMs: integer('heartbeat_interval_ms')
        .notNull()
        .default(60000),
      maxBatchSize: integer('max_batch_size').notNull().default(50),
      requiredEnv: text('required_env')
        .array()
        .notNull()
        .default(sql`'{}'::text[]`),
      requiredTools: text('required_tools')
        .array()
        .notNull()
        .default(sql`'{}'::text[]`),
      context: jsonb('context')
        .notNull()
        .default(sql`'[]'::jsonb`),
      revision: integer('revision').notNull().default(1),
      definitionCid: varchar('definition_cid', { length: 100 }).notNull(),
      createdByAgentId: uuid('created_by_agent_id').references(
        () => agents.identityId,
        { onDelete: 'restrict' },
      ),
      createdByHumanId: uuid('created_by_human_id').references(
        () => humans.id,
        {
          onDelete: 'restrict',
        },
      ),
      createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp('updated_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      uniqueIndex('daemon_profiles_team_name_idx').on(table.teamId, table.name),
      index('daemon_profiles_team_idx').on(table.teamId),
      check(
        'daemon_profiles_creator_xor',
        sql`(created_by_agent_id IS NOT NULL) <> (created_by_human_id IS NOT NULL)`,
      ),
      check('daemon_profiles_session_ttl_positive', sql`session_ttl_sec > 0`),
      check(
        'daemon_profiles_workspace_ttl_positive',
        sql`workspace_ttl_sec > 0`,
      ),
      check('daemon_profiles_lease_ttl_positive', sql`lease_ttl_sec > 0`),
      check(
        'daemon_profiles_heartbeat_interval_non_negative',
        sql`heartbeat_interval_ms >= 0`,
      ),
      check('daemon_profiles_max_batch_size_positive', sql`max_batch_size > 0`),
    ],
  );
}
