---
date: '2026-02-23T21:00:00Z'
author: claude-sonnet-4-6
session: unknown
type: handoff
importance: 0.6
tags: [mcp-server, diary, entries, terminology, tooling]
supersedes: null
signature: pending
---

# Handoff: MCP Tool Rename — `diary_*` → `diaries_*` / `entries_*` / `reflect`

## What Was Done This Session

- Renamed all 7 `diary_*` MCP tools that operate on **entries** to `entries_*` / `reflect`:
  - `diary_create` → `entries_create`
  - `diary_get` → `entries_get`
  - `diary_list` → `entries_list`
  - `diary_update` → `entries_update`
  - `diary_delete` → `entries_delete`
  - `diary_search` → `entries_search`
  - `diary_reflect` → `reflect`
- Added 3 new tools for diary **container** management (previously impossible via MCP):
  - `diaries_list` — list your diaries, returns IDs needed by all entry tools
  - `diaries_create` — create a new diary
  - `diaries_get` — get diary metadata by ID
- Fixed a pre-existing bug: `reflect` handler was callable without `diary_id` in tests but the REST API requires it; test now passes `diary_id`
- Added `tools/list` integration test in `server.test.ts` that asserts all new names are present and all old names are absent
- Updated `CLAUDE.md` MCP Tools table
- All schema types use api-client exported types (`CreateDiaryData`, `GetDiaryData`, `DiaryCatalog`, etc.) — no local type duplication

## What's Not Done

- No changes to REST API routes, operation IDs, or api-client — scope was MCP only
- No diary catalog `update`/`delete` MCP tools added (not requested; REST endpoints exist if needed later)

## Current State

- Branch: `feat/mcp-diary-entry-rename`
- Tests: 114 passing (up from 102 baseline), 0 failing
- Typecheck: clean
- Files changed: `apps/mcp-server/src/schemas.ts`, `apps/mcp-server/src/diary-tools.ts`, `apps/mcp-server/__tests__/diary-tools.test.ts`, `apps/mcp-server/__tests__/server.test.ts`, `CLAUDE.md`

## Decisions Made

- Kept `reflect` as a bare tool name (not `diaries_reflect` or `entries_reflect`) per user preference — it's a special digest operation, not a simple CRUD action
- Used `diaries_*` prefix (plural) for container tools to match REST route convention (`/diaries`)
- Used `entries_*` prefix (plural) for entry tools — consistent with the `diaries_*` pattern

## Where to Start Next

1. This PR needs review and merge
2. After merge, the `docs/MCP_SERVER.md` tool spec table should be updated to match (low priority, it's reference docs)
