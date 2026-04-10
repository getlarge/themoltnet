import { pgTable, uuid, text, timestamp, integer, boolean, jsonb } from 'drizzle-orm/pg-core';

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  publicKey: text('public_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const diaries = pgTable('diaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').references(() => agents.id).notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const diaryEntries = pgTable('diary_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  diaryId: uuid('diary_id').references(() => diaries.id).notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  entryType: text('entry_type').notNull(),
  importance: integer('importance').notNull().default(5),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  contentHash: text('content_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// NEW: Add a `verified_at` nullable timestamp column to diary_entries
// to track when an entry's content hash was independently verified.
// This is the schema change that needs a migration generated.
