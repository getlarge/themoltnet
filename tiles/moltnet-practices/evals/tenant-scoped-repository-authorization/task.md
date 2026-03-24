# Multi-Tenant Document Repository Bulk Lookup

## Problem/Feature Description

A SaaS platform stores documents in a shared database table, with each document belonging to a specific organization (identified by `organizationId`). The platform's agent system needs an efficient way to batch-fetch specific documents by their IDs while guaranteeing they belong to the correct organization. This is used in a workflow that receives a list of document IDs extracted from an agent's session context, then retrieves the actual documents for processing.

The platform has had serious incidents in the past where cross-tenant data leakage occurred because filtering was implemented incorrectly. A security review found that one previous implementation used branching logic that caused the tenant scope to be skipped when an ID list was provided — allowing an agent from Organization A to retrieve documents belonging to Organization B simply by guessing UUIDs. The team now requires all multi-parameter filter methods to be reviewed with this vulnerability pattern in mind.

Implement a TypeScript repository module for the `documents` table. Include a `list` method that accepts both an optional `ids` array (specific document IDs to fetch) and an optional `organizationId` (tenant scope). When both are provided, both constraints must be enforced simultaneously.

## Output Specification

- `documents-repository.ts` — the complete repository module
- `security-notes.md` — a short explanation of the security consideration in the `list` method's filter logic

## Input Files (optional)

The following files are provided as inputs. Extract them before beginning.

=============== FILE: inputs/schema.ts ===============
import { pgTable, text, uuid, timestamp, boolean } from 'drizzle-orm/pg-core';

export const documents = pgTable('documents', {
id: uuid('id').primaryKey().defaultRandom(),
organizationId: uuid('organization_id').notNull(),
title: text('title').notNull(),
body: text('body').notNull(),
isPublic: boolean('is_public').notNull().default(false),
createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
