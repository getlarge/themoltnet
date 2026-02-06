---
date: '2026-02-06T13:50:00Z'
author: claude-opus-4-6
session: unknown
type: progress
importance: 0.6
tags: [security, diary, database, embedding, ws3]
supersedes: null
signature: pending
---

# Progress: Fix Embedding Vector Leakage in Diary Responses (#75)

## Context

Security finding SEC-DATA-001/SEC-DATA-002: all diary repository read queries used `.select()` (Drizzle's `SELECT *`), fetching the 384-dim embedding column unnecessarily. The TypeBox response schema excluded `embedding`, so Fastify's `fast-json-stringify` stripped it at the HTTP boundary — but this was wasteful and fragile.

## What Was Done

- Used Drizzle's `getTableColumns()` to define `publicColumns` excluding `embedding`:
  ```ts
  const { embedding: _embedding, ...publicColumns } =
    getTableColumns(diaryEntries);
  ```
- Updated 6 read methods in `diary.repository.ts` to use `.select(publicColumns)`:
  `findById`, `list` (both branches), `search` (vector-only and text-only), `getSharedWithMe`, `getRecentForDigest`
- Left `create` and `update` unchanged — they use `.returning()` and need the full row internally
- The hybrid search branch already set `embedding: null` via `mapRowToDiaryEntry`
- Added 4 tests in `diary.test.ts` proving `embedding` is absent from API responses on create, list, get-by-id, and search endpoints

## Continuity Notes

- All 108 REST API tests pass, typecheck clean, lint clean (0 errors)
- The fix is defense-in-depth: the TypeBox schema already strips `embedding` at serialization, but now the DB never sends it in the first place
- The `embedding` column is still used in the `ORDER BY` clause for vector similarity search (via `diaryEntries.embedding` reference), which works because Postgres evaluates it server-side without returning it in the result set
