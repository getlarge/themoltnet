import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

interface ProjectSchemaDeps {
  agents: { id: AnyPgColumn };
  humans: { id: AnyPgColumn };
  teams: { id: AnyPgColumn };
  diaries: { id: AnyPgColumn };
}

export function defineProjectsTable({
  agents,
  humans,
  teams,
  diaries,
}: ProjectSchemaDeps) {
  /** Shared team catalogue; source folders and setup commands remain machine-local. */
  return pgTable(
    'projects',
    {
      id: uuid('id').defaultRandom().primaryKey(),
      teamId: uuid('team_id')
        .notNull()
        .references(() => teams.id, { onDelete: 'restrict' }),
      creatorAgentId: uuid('creator_agent_id').references(() => agents.id, {
        onDelete: 'restrict',
      }),
      creatorHumanId: uuid('creator_human_id').references(() => humans.id, {
        onDelete: 'restrict',
      }),
      name: varchar('name', { length: 255 }).notNull(),
      description: text('description'),
      defaultDiaryId: uuid('default_diary_id').references(() => diaries.id, {
        onDelete: 'set null',
      }),
      archived: boolean('archived').default(false).notNull(),
      createdAt: timestamp('created_at', { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp('updated_at', { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      uniqueIndex('projects_team_name_idx').on(
        table.teamId,
        sql`lower(btrim(${table.name}))`,
      ),
      index('projects_default_diary_idx')
        .on(table.defaultDiaryId)
        .where(sql`${table.defaultDiaryId} IS NOT NULL`),
      check(
        'projects_creator_xor',
        sql`(${table.creatorAgentId} IS NOT NULL) <> (${table.creatorHumanId} IS NOT NULL)`,
      ),
    ],
  );
}
