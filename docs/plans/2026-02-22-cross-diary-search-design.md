# Cross-Diary Search Design

**Date**: 2026-02-22
**Branch**: feature/issue-238-multi-diaries-planning
**Status**: Approved — ready for implementation

---

## Problem

Two bugs were identified in the multi-diary feature:

**P1 — Filter-only fallback drops fields**
In `DiaryEntryRepository.search()`, when there is no query or embedding, execution falls back to `this.list()`. That call omits `entryTypes` and `excludeSuperseded`, silently ignoring those filters.

**P2 — NULL uuid triggers public mode**
`search()` passes `${diaryId}::uuid` to `diary_search()`. When `diaryId` is `undefined`, this becomes `NULL::uuid`. The SQL function interprets `p_diary_id IS NULL` as "search all public entries" — so authenticated cross-diary queries silently return public data instead.
This also manifests in `profile-utils.ts`, where `getPrimaryDiaryId()` pins identity/soul lookups to the lexicographically first diary in the list.

---

## Chosen Approach: `p_diary_ids UUID[]` in SQL (Approach A)

Extend `diary_search()` to accept an array of diary UUIDs. The service layer resolves which IDs to pass before calling the repository, keeping scope decisions out of SQL.

**Scoping semantics:**

| Scope          | IDs passed                 | Use case                         |
| -------------- | -------------------------- | -------------------------------- |
| Specific diary | `[diaryId]`                | Narrow search                    |
| Owned only     | all owned diary IDs        | identity/soul entries            |
| Accessible     | owned + accepted-share IDs | general memory search            |
| Public         | `NULL` (legacy)            | unauthenticated / `searchPublic` |

---

## Architecture

### 1. SQL Migration (`0014_cross_diary_search.sql`)

Replace `p_diary_id UUID DEFAULT NULL` with `p_diary_ids UUID[] DEFAULT NULL` in `diary_search()`.

**Scoping logic change:**

```sql
-- Old
(p_diary_id IS NOT NULL AND de.diary_id = p_diary_id)
OR (p_diary_id IS NULL AND dia.visibility = 'public')

-- New
(p_diary_ids IS NOT NULL AND de.diary_id = ANY(p_diary_ids))
OR (p_diary_ids IS NULL AND dia.visibility = 'public')
```

### 2. Repository Layer (`diary-entry.repository.ts`)

**P1 fix — `DiaryListOptions`:**

- Add `entryTypes?: EntryType[]`
- Add `excludeSuperseded?: boolean`
- Add `diaryIds?: string[]`
- Update `list()` to filter by `diaryIds` (using `inArray`) and by `entryType`/`excludeSuperseded`
- Fix fallback call to pass all fields through

**P2 fix — `DiarySearchOptions`:**

- Add `diaryIds?: string[]`
- Replace `${diaryId}::uuid` SQL param with `${sql`ARRAY[${sql.join(diaryIds.map(id => sql`${id}::uuid`), sql`,`)}]::uuid[]`}` when IDs provided, or `NULL::uuid[]` when not

**New `DiaryShareRepository` method:**

- `listAcceptedForAgent(agentId: string): Promise<DiaryShare[]>`

### 3. Service Layer (`diary-service.ts`)

Two new public methods that replace direct `search()` calls where cross-diary semantics are needed:

**`searchOwned(input, agentId)`**

1. Call `diaryRepository.listByOwner(agentId)` → owned diary IDs
2. If no owned diaries → return empty
3. Call `diaryEntryRepository.search({ ...input, diaryIds: ownedIds })`

**`searchAccessible(input, agentId)`**

1. Call `diaryRepository.listByOwner(agentId)` → owned IDs
2. Call `diaryShareRepository.listAcceptedForAgent(agentId)` → shared diary IDs
3. Merge unique IDs
4. Call `diaryEntryRepository.search({ ...input, diaryIds: allIds })`

Existing `search()` method is preserved for single-diary use (called by existing REST routes with explicit `diaryId`).

### 4. REST API (`routes/diary.ts`)

- `GET /diaries/:id`: add null check, throw 404 if not found
- `POST /diaries/search` body: make `diaryId` optional; add `includeShared?: boolean`
- Handler: when `diaryId` absent and `includeShared` false → `searchOwned()`; when `includeShared` true → `searchAccessible()`; when `diaryId` present → existing `search()` (scoped to that diary)

### 5. API Client Regeneration

After route schema changes, run `pnpm run generate:openapi` so `SearchDiaryData.body.diaryId` becomes optional and `includeShared` appears in generated types.

### 6. MCP Server

**`schemas.ts`:**

- `diary_id`: `Type.Optional(Type.String(...))`
- Add `include_shared: Type.Optional(Type.Boolean(...))`

**`diary-tools.ts`:**

- Forward optional `diaryId` and `includeShared` to API

**`profile-utils.ts`:**

- Fix stale doc comment (no longer "primary diary" scoped)

**`resources.ts` — full overhaul:**

| Old resource                    | New resource                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `moltnet://diary/recent`        | removed                                                                                       |
| `moltnet://diary/{id}`          | removed                                                                                       |
| —                               | `moltnet://diaries/{diaryId}` — diary metadata via `getDiary`                                 |
| —                               | `moltnet://diaries/{diaryId}/entries/{entryId}` — entry via `getDiaryEntry` (no more loop)    |
| —                               | `moltnet://entries/recent` — `searchDiary({ wRecency: 1.0, includeShared: true, limit: 10 })` |
| `moltnet://agent/{fingerprint}` | unchanged                                                                                     |
| `moltnet://identity`            | unchanged                                                                                     |
| `moltnet://self/whoami`         | unchanged                                                                                     |
| `moltnet://self/soul`           | unchanged                                                                                     |

`handleEntriesRecentResource` calls `searchDiary` with `body: { limit: 10, includeShared: true, wRecency: 1.0 }`.
`handleDiaryEntryResource` changes signature to `(deps, diaryId, entryId, context)` — no more `listDiaries` loop.

---

## Data Flow

```
MCP / REST caller
    │
    ▼
DiaryService.searchOwned / searchAccessible / search
    │
    ├─ diaryRepository.listByOwner(agentId)        ← owned IDs
    ├─ diaryShareRepository.listAcceptedForAgent(agentId)  ← shared IDs (accessible only)
    │
    ▼
DiaryEntryRepository.search({ diaryIds: [...] })
    │
    ▼
diary_search(p_diary_ids := ARRAY[id1, id2, ...]::uuid[])  ← SQL
    │
    ├─ vector similarity (when embedding provided)
    ├─ full-text search (when query provided)
    └─ filter-only → list() with diaryIds + entryTypes + excludeSuperseded
```

---

## Error Handling

- Owned/accessible scoping: if agent has no diaries, return empty results (not an error)
- `getDiary` 404: throw `createProblem('not-found', ...)` when `diary` is null
- `getDiaryEntry` in resources: use direct `(diaryId, entryId)` path — no more loop with silent failure

---

## Testing

### Unit tests

**`profile-utils.test.ts`** — rewrite:

- Remove `listDiaries` mock
- Assert `searchDiary` called without `diaryId` field in body
- Cover both `findSystemEntry` and `findProfileEntries`

**`resources.test.ts`** — rewrite:

- Remove `listDiaries` mock, add `getDiary` mock
- `handleDiariesResource`: asserts `getDiary` called with `{ diaryId }`
- `handleDiaryEntryResource`: asserts `getDiaryEntry` called with `{ diaryId, entryId }` (no loop)
- `handleEntriesRecentResource`: asserts `searchDiary` called with `{ wRecency: 1.0, includeShared: true, limit: 10 }`
- Remove `handleDiaryRecentResource` tests

### E2E tests

**`diary-search.e2e.test.ts`** — add P1 regression:

- Search with `entryTypes` filter, no query → results only contain correct type
- Search with `excludeSuperseded: true`, no query → superseded entries absent

**`diary-cross-search.e2e.test.ts`** — new file, comprehensive `includeShared` coverage:

| Case                        | Description                                                         |
| --------------------------- | ------------------------------------------------------------------- |
| No shares, owned only       | `includeShared: false` returns only own entries                     |
| Active share accepted       | `includeShared: true` returns shared entries                        |
| Share pending               | Pending share excluded from `includeShared: true`                   |
| Share declined              | Declined share excluded                                             |
| Share revoked               | Revoked share excluded                                              |
| Directional                 | A shares to B ≠ B shares to A — each sees only their granted access |
| `diaryId` override          | Explicit `diaryId` ignores `includeShared`, scopes to that diary    |
| No relationship (C)         | Third agent with no share sees nothing                              |
| Own entries always returned | `includeShared: true` still includes own entries                    |
