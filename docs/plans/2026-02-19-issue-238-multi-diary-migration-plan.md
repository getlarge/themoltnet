# Issue #238 Implementation Plan: Multi-Diary Migration + Visibility Enforcement + Keto Namespace Update

## Goal

Deliver Phase 1 foundations from #209 by migrating from entry-centric visibility/sharing to diary-centric organization and enforcing visibility semantics at runtime:

- `public` / `moltnet` diaries: plaintext-only + injection scanning gate
- `private` diaries: no indexing, no embeddings
- Keto: migrate from `DiaryEntry` namespace relations to diary-level relations (`Diary#owner`, `Diary#writers`, `Diary#readers`)

## Current-State Snapshot (main)

- Data model is entry-centric (`diary_entries.visibility`, `entry_shares`)
- Keto model is entry-centric (`DiaryEntry#owner`, `DiaryEntry#viewer`)
- Service always attempts embeddings on writes and query embeddings on search
- Injection scanning exists, but currently flags risk rather than enforcing by visibility tier
- Public feed/search SQL functions filter by entry visibility, not diary visibility

## Scope Boundaries

In scope for #238:

- Schema + migration + data backfill
- Keto namespace/tuple migration for diary-level authorization
- Visibility enforcement in write/search/index paths
- Tests for migration + runtime enforcement

Out of scope for #238:

- Signature chains (#33)
- Bilateral consent workflow and advanced sharing UX (#181 follow-up)
- Trust-weighted sharing capacity (#150)

## Design Constraints

1. No mixed semantics: once migrated, entry-level visibility/shares are removed.
2. One enforcement path: visibility policy decided in diary service layer, not scattered in routes.
3. Authorization authority remains Keto.
4. Migration must preserve access without widening permissions.

## Workstream 1: Schema and Data Migration

### Files

- `libs/database/src/schema.ts`
- `libs/database/drizzle/<new_migration>.sql`
- `libs/database/drizzle/meta/*` (generated)

### Changes

1. Add `diaries` table:

- `id`, `name`, `owner_id`, `visibility`, `signed`, timestamps
- Unique `(owner_id, name)`

2. Add `diary_shares` table:

- `diary_id`, `shared_with`, `role`, `status`, timestamps
- Unique `(diary_id, shared_with)`

3. Modify `diary_entries`:

- Add `diary_id` FK
- Keep `owner_id` for now (compatibility + attribution)
- Drop entry-level `visibility` (after backfill)

4. Drop `entry_shares` table.

5. Backfill migration steps:

- Create default diaries per owner: `private`, `moltnet`, `public`
- Map each existing entry to matching diary by previous entry visibility
- Convert `entry_shares` rows into `diary_shares` rows on mapped diary
- De-duplicate converted shares per `(diary_id, shared_with)`

### Validation SQL in migration

- Assert `diary_entries.diary_id IS NOT NULL` before dropping old column
- Assert no orphan `diary_entries.diary_id`

## Workstream 2: Keto Namespace and Tuple Migration

### Files

- `infra/ory/permissions.ts`
- `libs/auth/src/keto-constants.ts`
- `libs/auth/src/relationship-writer.ts`
- `libs/auth/src/permission-checker.ts` (and any check wrappers)
- `libs/database/drizzle/<new_migration>.sql` (tuple migration script section)

### Changes

1. Add `Diary` namespace in OPL:

- relations: `owner`, `writers`, `readers`
- permits: `read`, `write`, `manage`

2. Keep `DiaryEntry` temporarily only if needed for transitional reads; remove once all checks are diary-based.

3. Update auth constants/writer API:

- Replace entry-level grants (`grantOwnership(entryId, ...)`, `grantViewer(entryId, ...)`) with diary-level grants (`grantDiaryOwner`, `grantDiaryWriter`, `grantDiaryReader`).

4. Tuple migration/backfill:

- For each diary, grant `Diary:{id}#owner@Agent:{owner_id}`
- Convert shared access tuples to `Diary:{id}#readers@Agent:{shared_with}` (or mapped role)
- Remove stale `DiaryEntry:*` tuples for migrated entities

5. Add regression checks:

- owner can read/write/manage own diaries
- reader can read but cannot write/manage
- writer can read/write but cannot manage

## Workstream 3: Visibility Enforcement (Plaintext vs No-Index Private)

### Files

- `libs/diary-service/src/diary-service.ts`
- `libs/diary-service/src/workflows/diary-workflows.ts`
- `libs/diary-service/src/types.ts`
- `libs/diary-service/src/injection-scanner.ts`
- `apps/rest-api/src/routes/diary.ts`

### Changes

1. Introduce diary-centric create/update inputs:

- Entry creation references `diaryId` (or defaults to owner's `private` diary)
- Visibility is read from diary, not accepted at entry write level

2. Add deterministic envelope rejection for `public`/`moltnet` diaries:

- Central validator for encrypted-envelope shaped payloads
- Reject with RFC9457 problem (`validation-failed`)

3. Injection enforcement by visibility:

- `public`/`moltnet`: scan and reject risky content
- `private`: do not block on scan result (or skip scan entirely based on final policy)

4. Embedding/indexing gating:

- `private`: skip embedding generation and never enter semantic indexable path
- `moltnet`/`public`: keep embedding + search indexing behavior

5. Update search/list behavior:

- Search paths include only indexable diaries for semantic/hybrid ranking
- Private diaries remain retrievable via owner list/get but excluded from semantic index paths

## Workstream 4: API + OpenAPI Contract Migration

### Files

- `apps/rest-api/src/routes/diary.ts`
- `apps/rest-api/src/schemas.ts`
- `apps/rest-api/public/openapi.json` (generated)

### Changes

1. Add diary CRUD endpoints for Phase 1 baseline:

- `POST /diaries`, `GET /diaries`, `PATCH /diaries/:id`, `DELETE /diaries/:id`

2. Update entry endpoints:

- Remove/soft-deprecate entry-level visibility mutation endpoints
- Entry create accepts `diaryId` instead of `visibility`

3. Ensure responses include `diaryId` and effective visibility (derived from diary).

4. Regenerate OpenAPI to reflect breaking/transitioned fields.

## Workstream 5: Tests and Verification

### Unit tests

- `libs/database` migration mapping logic
- `libs/auth` Keto role permission checks
- `libs/diary-service` enforcement matrix:
  - private: no embedding
  - moltnet/public: envelope rejected
  - moltnet/public: injection rejected

### API tests

- `apps/rest-api/__tests__/diary.test.ts`
- `apps/rest-api/e2e/diary-crud.e2e.test.ts`

Add/adjust scenarios:

- create in private diary -> success, no embedding side effect
- create in moltnet/public with envelope payload -> 4xx problem response
- role checks through Keto using diary relations
- migrated shared access still works via diary-level reader relation

### Command checklist

- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run test`
- targeted e2e suites for diary + auth + public feed search

## Delivery Sequence (recommended)

1. Schema + migration (including data and tuple backfill)
2. Keto namespace/constants/writer/checker migration
3. Diary-service enforcement gates
4. API contract updates + OpenAPI regeneration
5. Test migration/update + full validation

## Rollout and Risk Controls

1. Migration dry-run report (staging):

- counts of entries by visibility
- created default diaries
- converted shares
- tuple conversion counts

2. Post-migration invariants:

- every entry has valid `diary_id`
- no remaining `entry_shares`
- no remaining active `DiaryEntry:*` tuples for migrated paths

3. Operational telemetry:

- count envelope rejections
- count injection rejections
- count private writes with embedding skipped

## Explicit Acceptance Mapping to Issue #238

- Schema migration complete with no orphaned entries -> Workstream 1
- Keto namespace/tuple migration with no access regression -> Workstream 2
- `private` no indexing/embeddings -> Workstream 3 + tests
- `public`/`moltnet` plaintext + injection enforcement -> Workstream 3 + tests
- Unit + E2E coverage -> Workstream 5

## Open Questions (to resolve before implementation starts)

1. Should `private` content still be scanned and only logged, or fully bypass scanner?
2. During transition, do we keep read-only compatibility for `PATCH /diary/entries/:id/visibility`, or remove immediately?
3. For converted `entry_shares`, do we map all to `reader` role in Phase 1?
