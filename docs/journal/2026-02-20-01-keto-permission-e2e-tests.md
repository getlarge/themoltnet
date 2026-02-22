---
date: '2026-02-20T21:00:00Z'
author: claude-opus-4-6
session: unknown
type: handoff
importance: 0.9
tags: [multi-diary, keto, permissions, sharing, e2e, api-client, rest-api]
supersedes: null
signature: pending
---

# Multi-Diary: Full Implementation + Keto Permission E2E Tests

## Context

Issue #238: agents need multiple diaries (e.g. separate "work" and "personal"
journals). Previously every agent had a single implicit diary. This branch
introduces named diary catalogs, a sharing/invitation lifecycle, and Keto-based
permission enforcement — then proves it all works end-to-end.

## Substance

### Phase 1 — Repository & schema split

- Split the monolithic diary repository into `DiaryCatalogRepository` (diary-level
  CRUD: create, list, findByKey, findOwnedById, update, delete) and kept the
  existing `DiaryEntryRepository` scoped per-diary.
- Created `DiaryShareRepository` for managing invitation records (create, findById,
  findByDiaryAndAgent, listPendingForAgent, listByDiary, updateStatus).
- Entry routes now resolve a `diaryRef` param (UUID or key) before operating on
  entries, replacing the old implicit owner-scoped queries.

### Phase 2 — Diary management endpoints

- `POST /diaries` — create a named diary, grants Keto `owner` relation
- `GET /diaries` — list own diaries
- `PATCH /diaries/:diaryRef` — update name/visibility (owner-only via DB check)
- `DELETE /diaries/:diaryRef` — delete diary + `removeDiaryRelations` in Keto

### Phase 3 — Sharing & invitation lifecycle

- `POST /diaries/:diaryRef/share` — owner invites another agent (by fingerprint)
  as reader or writer; creates a `pending` share record
- `GET /diaries/:diaryRef/share` — owner lists all shares for a diary (new)
- `GET /diary/invitations` — list pending invitations for the current agent
- `POST /diary/invitations/:id/accept` — accept invite, grants Keto
  `readers`/`writers` relation
- `POST /diary/invitations/:id/decline` — decline invite
- `DELETE /diaries/:diaryRef/share/:fingerprint` — owner revokes share,
  calls `removeDiaryRelationForAgent` in Keto

Re-invite resets the share to `pending` with the new role and clears
`respondedAt`; accepting then grants the updated Keto relation.

### Phase 4 — Keto permission model

```
Diary namespace:
  owner   → Agent[]     (manage + write + read)
  writers → Agent[]     (write + read)
  readers → Agent[]     (read only)
```

Entry endpoints call `resolveDiary(diaryRef, requesterId, accessMode)` which
checks ownership first, then falls back to `canAccessDiary()` for Keto
permission checks. Diary management endpoints (PATCH, DELETE, share) use a
simpler `findOwnedById` guard — only the owner can manage.

### Phase 5 — Bug fixes

- Fixed re-invite: pass `null` for `respondedAt` (not `undefined`) so the DB
  column is cleared; persist the updated role so accept grants the correct
  Keto relation.
- Used `updated.role` (not stale `share.role`) in the accept handler.
- Used `diary.id` instead of the raw `diaryRef` param for Keto cleanup on delete.
- Added unit test for `removeDiaryRelationForAgent`.

### Phase 6 — E2E tests & typed API client

Rewrote `diary-management.e2e.test.ts` to use the typed API client from
`@moltnet/api-client`, removing the raw `api()` fetch helper entirely (it
was causing Fastify 5 `FST_ERR_CTP_EMPTY_JSON_BODY` errors on bodyless
requests). Regenerated the client from the OpenAPI spec.

Added a third test agent (`agentC`) and 7 new Keto boundary test groups
(~18 tests):

1. **Reader role enforcement** — can list but CANNOT create/update/delete entries
2. **Writer role enforcement** — can read+write but CANNOT PATCH/DELETE diary or manage shares
3. **Role change on re-invite** — writer→reader downgrade denies write
4. **Owner retains access after sharing** — owner keeps full CRUD
5. **Delete diary cleans Keto** — shared agents lose access when diary deleted
6. **Non-owner cannot manage diary** — PATCH, DELETE, share, list shares, revoke all 404
7. **Owner can list shares** — sees shares with correct roles; writer cannot list

**Result**: 189 tests pass across 16 e2e suites (45 in diary-management alone).

## Files Changed

| Area       | Files                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------- |
| Schema     | `libs/database/src/schema.ts`, `libs/database/src/repositories/diary-share.repository.ts` |
| Routes     | `apps/rest-api/src/routes/diary.ts`, `apps/rest-api/src/schemas.ts`                       |
| Auth       | `libs/auth/src/keto.ts` (`removeDiaryRelationForAgent`)                                   |
| API client | `libs/api-client/src/generated/*` (regenerated), `apps/rest-api/public/openapi.json`      |
| Tests      | `apps/rest-api/e2e/diary-management.e2e.test.ts`, `apps/rest-api/__tests__/diary.test.ts` |

## Continuity Notes

- The `api()` raw fetch helper in e2e tests is now fully replaced by the typed
  client. Any new e2e tests should use the client exclusively.
- The OpenAPI spec and api-client must be regenerated when routes change
  (`pnpm run generate:openapi && pnpm --filter @moltnet/api-client run generate`).
- MCP server diary tools still operate on the default diary — they haven't been
  updated to support multi-diary yet (future work).
