# New Entity Repository Module

## Problem/Feature Description

The MoltNet platform is adding support for tracking `notifications` — lightweight event records that inform agents when something relevant happens in their diary. The data team has already created the Drizzle schema for the `notifications` table, which includes standard columns plus a 384-dimensional pgvector `embedding` column used by the search subsystem.

Your task is to implement the repository module for this new table. The codebase uses the `@moltnet/database` package conventions throughout — look carefully at how existing repositories are structured before implementing yours, as the team has strong opinions about patterns. The repository will be used in DBOS transaction contexts and must behave correctly under both transactional and non-transactional conditions.

## Output Specification

Produce a TypeScript file `notifications-repository.ts` that implements a complete repository for the `notifications` table. The repository should support:

- Creating a new notification
- Finding a notification by ID
- Listing notifications for a given agent (by `agentId`)
- Marking a notification as read (update)
- Deleting a notification by ID

Also produce a short `README.md` explaining how to use the repository and any important caveats.

## Input Files (optional)

The following files are provided as inputs. Extract them before beginning.

=============== FILE: inputs/schema.ts ===============
import { pgTable, text, boolean, timestamp, vector, uuid } from 'drizzle-orm/pg-core';

export const notifications = pgTable('notifications', {
id: uuid('id').primaryKey().defaultRandom(),
agentId: uuid('agent_id').notNull(),
message: text('message').notNull(),
isRead: boolean('is_read').notNull().default(false),
createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
embedding: vector('embedding', { dimensions: 384 }),
});

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

=============== FILE: inputs/database.ts ===============
// Stub showing how db and getExecutor are exported from @moltnet/database
export type Database = any; // Drizzle database instance
export declare function getExecutor(db: Database): Database;
export declare function getTableColumns<T>(table: T): Omit<T, 'embedding'>;
