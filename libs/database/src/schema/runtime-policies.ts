import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

interface RuntimePolicySchemaDeps {
  agents: { identityId: AnyPgColumn };
  humans: { id: AnyPgColumn };
  teams: { id: AnyPgColumn };
}

/**
 * Runtime tool policy: thin SQL metadata for a team-scoped, named policy.
 *
 * The authorization edges — which tools a policy grants and which profiles
 * reference it — live in Keto (`RuntimePolicy#tool@Tool:<name>`,
 * `RuntimeProfile#policies@RuntimePolicy`). This table only holds the display
 * metadata (name, description, creator, timestamps) so the API can list and
 * describe policies without expanding the graph.
 *
 * Policies are always team-owned (`team_id` is NOT NULL), so the creator XOR is
 * the same shape as `runtime_profiles`: exactly one of agent/human.
 */
export function defineRuntimePoliciesTable({
  agents,
  humans,
  teams,
}: RuntimePolicySchemaDeps) {
  return pgTable(
    'runtime_policies',
    {
      id: uuid('id').defaultRandom().primaryKey(),
      teamId: uuid('team_id')
        .notNull()
        .references(() => teams.id, { onDelete: 'restrict' }),
      name: varchar('name', { length: 100 }).notNull(),
      description: text('description'),
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
      uniqueIndex('runtime_policies_team_name_idx').on(
        table.teamId,
        table.name,
      ),
      check(
        'runtime_policies_creator_xor',
        sql`(created_by_agent_id IS NOT NULL) <> (created_by_human_id IS NOT NULL)`,
      ),
      check(
        'runtime_policies_description_length',
        sql`description IS NULL OR length(description) <= 4096`,
      ),
    ],
  );
}
