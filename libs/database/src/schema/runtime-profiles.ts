import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  check,
  doublePrecision,
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

interface RuntimeProfileSchemaDeps {
  agents: { identityId: AnyPgColumn };
  humans: { id: AnyPgColumn };
  teams: { id: AnyPgColumn };
  runtimeKindEnum: PgEnum<['gondolin_pi']>;
  storageModeEnum: PgEnum<['local']>;
}

export function defineRuntimeProfilesTable({
  agents,
  humans,
  teams,
  runtimeKindEnum,
  storageModeEnum,
}: RuntimeProfileSchemaDeps) {
  return pgTable(
    'runtime_profiles',
    {
      id: uuid('id').defaultRandom().primaryKey(),
      teamId: uuid('team_id')
        .notNull()
        .references(() => teams.id, { onDelete: 'restrict' }),
      name: varchar('name', { length: 100 }).notNull(),
      description: text('description'),
      preset: varchar('preset', { length: 64 })
        .notNull()
        .default('standard@v1'),
      provider: varchar('provider', { length: 100 }).notNull(),
      model: varchar('model', { length: 200 }).notNull(),
      thinkingLevel: varchar('thinking_level', { length: 16 }),
      temperature: doublePrecision('temperature'),
      topP: doublePrecision('top_p'),
      topK: integer('top_k'),
      maxOutputTokens: integer('max_output_tokens'),
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
      defaultWorkspaceMode: varchar('default_workspace_mode', {
        length: 32,
      }),
      allowedWorkspaceModes: text('allowed_workspace_modes')
        .array()
        .notNull()
        .default(
          sql`ARRAY['none','shared_mount','dedicated_worktree']::text[]`,
        ),
      sessionTtlSec: integer('session_ttl_sec').notNull().default(1800),
      workspaceTtlSec: integer('workspace_ttl_sec').notNull().default(1800),
      leaseTtlSec: integer('lease_ttl_sec').notNull().default(300),
      heartbeatIntervalMs: integer('heartbeat_interval_ms')
        .notNull()
        .default(60000),
      maxBatchSize: integer('max_batch_size').notNull().default(50),
      maxTurns: integer('max_turns').notNull().default(0),
      maxBashTimeouts: integer('max_bash_timeouts').notNull().default(3),
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
      uniqueIndex('runtime_profiles_team_name_idx').on(
        table.teamId,
        table.name,
      ),
      index('runtime_profiles_team_idx').on(table.teamId),
      check(
        'runtime_profiles_creator_xor',
        sql`(created_by_agent_id IS NOT NULL) <> (created_by_human_id IS NOT NULL)`,
      ),
      check(
        'runtime_profiles_preset_valid',
        sql`preset = ANY(ARRAY['standard@v1','interactive-direct@v1']::text[])`,
      ),
      check('runtime_profiles_session_ttl_positive', sql`session_ttl_sec > 0`),
      check(
        'runtime_profiles_workspace_ttl_positive',
        sql`workspace_ttl_sec > 0`,
      ),
      check('runtime_profiles_lease_ttl_positive', sql`lease_ttl_sec > 0`),
      check(
        'runtime_profiles_heartbeat_interval_non_negative',
        sql`heartbeat_interval_ms >= 0`,
      ),
      check(
        'runtime_profiles_max_batch_size_positive',
        sql`max_batch_size > 0`,
      ),
      check('runtime_profiles_max_turns_non_negative', sql`max_turns >= 0`),
      check(
        'runtime_profiles_max_bash_timeouts_non_negative',
        sql`max_bash_timeouts >= 0`,
      ),
      check(
        'runtime_profiles_thinking_level_valid',
        sql`thinking_level IS NULL OR thinking_level = ANY(ARRAY['off','minimal','low','medium','high','xhigh']::text[])`,
      ),
      check(
        'runtime_profiles_temperature_range',
        sql`temperature IS NULL OR (temperature >= 0 AND temperature <= 2)`,
      ),
      check(
        'runtime_profiles_top_p_range',
        sql`top_p IS NULL OR (top_p >= 0 AND top_p <= 1)`,
      ),
      check('runtime_profiles_top_k_positive', sql`top_k IS NULL OR top_k > 0`),
      check(
        'runtime_profiles_max_output_tokens_positive',
        sql`max_output_tokens IS NULL OR max_output_tokens > 0`,
      ),
      check(
        'runtime_profiles_default_workspace_mode_valid',
        sql`default_workspace_mode IS NULL OR default_workspace_mode = ANY(ARRAY['none','shared_mount','dedicated_worktree']::text[])`,
      ),
      check(
        'runtime_profiles_allowed_workspace_modes_nonempty',
        sql`cardinality(allowed_workspace_modes) BETWEEN 1 AND 3`,
      ),
      check(
        'runtime_profiles_allowed_workspace_modes_valid',
        sql`allowed_workspace_modes <@ ARRAY['none','shared_mount','dedicated_worktree']::text[]`,
      ),
      check(
        'runtime_profiles_default_workspace_mode_allowed',
        sql`default_workspace_mode IS NULL OR default_workspace_mode = ANY(allowed_workspace_modes)`,
      ),
    ],
  );
}
