# Handoff: Multi-Diary PR #258 — Code Review Fixes

**Date**: 2026-02-23
**Type**: handoff
**Tags**: multi-diary, keto, sharing, go-cli, architecture

---

## What Was Done

Addressed all code review feedback on PR #258 (multi-diary catalogs, sharing, Keto
enforcement). Across two sessions, the following work was completed:

### Critical Bug Fixes

- **`createDiaryRepository` alias removed** (`diary-entry.repository.ts:746`): The
  alias was shadowing the real `createDiaryRepository` from `diary.repository.ts`,
  breaking 4 unit tests in CI.
- **`diaryRef` → `diary.id` in share/revoke handlers**: Route handlers were passing
  the raw URL param instead of the resolved diary's ID to service calls. Fixed in
  `POST /diaries/:id/share` and `DELETE /diaries/:id/share/:fingerprint`.
- **Transaction atomicity**: Wrapped `acceptInvitation`, `revokeShare`, and
  `deleteDiary` in `transactionRunner.runInTransaction()` to match the pattern in
  `hooks.ts`.
- **`onConflictDoNothing()` in diary-share create**: Prevents duplicate invitation
  race condition; returns `null` on conflict so the route can return 409.
- **`conflict` problem type missing from registry**: `createProblem('conflict', ...)`
  was throwing `Unknown problem type slug` because neither `registry.ts` nor the
  `ProblemCodeSchema` union had the `'CONFLICT'` code. Added to both.

### Entry-Level Sharing Removed

Dropped the old `entry_shares` system entirely:

- `entryShares` table removed from `schema.ts`
- `share()`, `unshare()`, `getSharedWithMe()` removed from `diary-entry.repository.ts`
- `share()`, `getSharedWithMe()` removed from `diary-service.ts`
- `grantViewer()` removed from `relationship-writer.ts`
- `share()`, `sharedWithMe()` removed from SDK `DiaryNamespace`
- `sharing.e2e.test.ts` deleted
- Migration `0013_drop-entry-shares.sql` generated to drop the table
- Stale mocks cleaned up in test helpers

### MCP Server Fixes

- `diary_id` → `diary_ref` in all 7 MCP tool schemas (user-facing UX name)
- `diary_set_visibility` tool removed (tool count 21 → 20)
- Public diary created in e2e setup using `POST /diaries`
- `search()` fallback to `list()` now passes `entryTypes` filter through
- `DiaryEntryRepository.list()` accepts optional `entryTypes` filter

### API URL Standardization

- `/diary/invitations` → `/diaries/invitations`
- `/diary/invitations/:id/accept` → `/diaries/invitations/:id/accept`
- `/diary/invitations/:id/decline` → `/diaries/invitations/:id/decline`
- `/diary/search` → `/diaries/search`
- `/diary/reflect` → `/diaries/reflect`

### Go CLI Updated

- `go generate ./...` regenerated all ogen client files from updated OpenAPI spec
- `cmd/moltnet/diary.go`: added `-diary-id` flag, removed `-visibility`, updated
  all params structs (`CreateDiaryEntryParams`, `GetDiaryEntryParams`, etc.)
- `cmd/moltnet/diary_test.go`: updated stub signatures, added `testDiaryID`

### Unit Tests Added

9 new tests in `apps/rest-api/__tests__/diary.test.ts`:

- `POST /diaries/:id/share` — 201 success, 409 already_shared, 404 not found
- `POST /diaries/invitations/:id/accept` — 200 success, 404 not found, 400 wrong_status
- `DELETE /diaries/:id/share/:fingerprint` — 200 success, 404 not found
- `DELETE /diaries/:id` — 200 success, 404 not found

### Documentation Updated

`docs/ARCHITECTURE.md` fully updated for multi-diary model:

- ER diagram: `entry_shares` removed, `diaries` and `diary_shares` tables added,
  `diary_entries` updated (no `owner_id`/`visibility`, has `diary_id` FK),
  `keto_Diary` namespace added (owner/writers/readers)
- Sequence diagram: rewritten for create-diary → create-entry → invite → accept flow
- Keto permission model: `Diary` namespace (owner/readers/writers) + `DiaryEntry`
  (parent-only), with transitive permission checks shown
- Entity-to-Keto map: updated to show `diaries`/`diary_shares` events
- System diagram: Supabase → Fly.io Postgres

PR body updated: correct URLs, test counts (219 unit, 203 REST e2e, 36 MCP e2e),
new bug fix bullets.

---

## Current State

PR #258 is a draft. All tests pass locally (unit + e2e). CI has not been re-run
against the full commit set yet.

**Test counts:**

- Unit: 219 (rest-api 219, other workspaces all pass)
- REST API e2e: 203 across 16 suites
- MCP server e2e: 36 across 3 suites

---

## What's Next

1. **Remove draft status from PR #258** and request review
2. **CI pipeline** — ensure lint, typecheck, test, build all pass on the branch
3. **`pnpm run generate:openapi` + `pnpm --filter @moltnet/api-client run generate`**
   — may need a re-run if the OpenAPI spec changed since last generation
4. **`listByDiary` status filter** (Step 6 of the plan): the plan called for an
   optional `statuses` param defaulting to `['pending', 'accepted']`. This was
   partially implemented but should be verified
5. **Private key deletion guard removal** (Step 7): the `if (diary.key === 'private')`
   guard was identified but status of removal should be verified in the route
