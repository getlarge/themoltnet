import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

interface RuntimeModelSchemaDeps {
  agents: { identityId: AnyPgColumn };
  humans: { id: AnyPgColumn };
  teams: { id: AnyPgColumn };
}

/**
 * Runtime model catalog: a list of supported provider/model couples.
 *
 * `team_id IS NULL`  => global entry (MoltNet-seeded).
 * `team_id IS NOT NULL` => team-owned entry (custom).
 *
 * Scope is intrinsic to the row: two partial unique indexes partition the
 * table so the same (provider, model) can exist once globally and once per
 * team, but never twice globally or twice within the same team.
 *
 * `capabilities` is a free-form JSONB field. Per the design comment, runtime
 * kind / auth kind stay out of the core schema — they can be added there as
 * optional metadata when usage demands.
 */
export function defineRuntimeModelsTable({
  agents,
  humans,
  teams,
}: RuntimeModelSchemaDeps) {
  return pgTable(
    'runtime_models',
    {
      id: uuid('id').defaultRandom().primaryKey(),
      teamId: uuid('team_id').references(() => teams.id, {
        onDelete: 'cascade',
      }),
      provider: varchar('provider', { length: 100 }).notNull(),
      model: varchar('model', { length: 200 }).notNull(),
      displayName: varchar('display_name', { length: 200 }),
      description: text('description'),
      capabilities: jsonb('capabilities')
        .notNull()
        .default(sql`'{}'::jsonb`),
      isActive: boolean('is_active').notNull().default(true),
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
      uniqueIndex('runtime_models_global_uq')
        .on(table.provider, table.model)
        .where(sql`team_id IS NULL`),
      uniqueIndex('runtime_models_team_uq')
        .on(table.teamId, table.provider, table.model)
        .where(sql`team_id IS NOT NULL`),
      index('runtime_models_team_idx').on(table.teamId),
      index('runtime_models_provider_idx').on(table.provider),
      check(
        'runtime_models_creator_xor',
        sql`(team_id IS NULL AND created_by_agent_id IS NULL AND created_by_human_id IS NULL) OR (team_id IS NOT NULL AND ((created_by_agent_id IS NOT NULL) <> (created_by_human_id IS NOT NULL)))`,
      ),
      check(
        'runtime_models_description_length',
        sql`description IS NULL OR length(description) <= 4096`,
      ),
      check(
        'runtime_models_capabilities_shape',
        sql`capabilities IS NULL OR jsonb_typeof(capabilities) = 'object'`,
      ),
    ],
  );
}
