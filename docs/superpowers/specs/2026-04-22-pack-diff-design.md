# Pack Diff API — Design Spec

**Date:** 2026-04-22  
**Issue:** [#471](https://github.com/getlarge/themoltnet/issues/471)  
**Status:** Approved

## Problem

Agents and operators need to compare two context packs to understand what changed between them — entry additions, removals, rank shifts, content drift, and token budget impact. There is currently no way to do this without fetching both packs in full and diffing them client-side.

## Scope

- Same-diary packs only (cross-diary diffing deferred)
- REST endpoints + MCP tool
- No new database tables; no stored diff results

## API Shape

### REST Endpoints

```
GET /packs/:id/diff/:otherId
GET /packs/by-cid/:cid/diff/by-cid/:otherCid
```

Both routes resolve to the same service method. The `by-cid` variant follows the existing provenance convention (`GET /packs/by-cid/:cid/provenance`).

### MCP Tool

```
packs_diff
```

Input (snake_case):
```ts
{
  pack_id?: string        // UUID — mutually exclusive with pack_cid
  pack_cid?: string       // CID  — mutually exclusive with pack_id
  other_pack_id?: string  // UUID — mutually exclusive with other_pack_cid
  other_pack_cid?: string // CID  — mutually exclusive with other_pack_id
}
```

Exactly one of `(pack_id, pack_cid)` and exactly one of `(other_pack_id, other_pack_cid)` required. Validated with TypeBox `oneOf`, same pattern as `PackProvenanceSchema`.

### Response Schema

```ts
{
  added: Array<{
    entryId: string
    rank: number
    title: string | null
    entryCidSnapshot: string
    compressionLevel: 'full' | 'summary' | 'keywords'
    packedTokens: number | null
  }>
  removed: Array<{
    entryId: string
    rank: number
    title: string | null
    entryCidSnapshot: string
    compressionLevel: 'full' | 'summary' | 'keywords'
    packedTokens: number | null
  }>
  reordered: Array<{
    entryId: string
    oldRank: number
    newRank: number
    title: string | null
    entryCidSnapshot: string
    compressionLevel: 'full' | 'summary' | 'keywords'
    packedTokens: number | null
  }>
  changed: Array<{
    entryId: string
    rank: number                         // rank in packB; oldRank omitted — rank shift is secondary to content change
    title: string | null
    oldEntryCidSnapshot: string
    newEntryCidSnapshot: string
    oldCompressionLevel: 'full' | 'summary' | 'keywords'
    newCompressionLevel: 'full' | 'summary' | 'keywords'
    oldPackedTokens: number | null
    newPackedTokens: number | null
    tokenDelta: number
  }>
  stats: {
    addedCount: number
    removedCount: number
    reorderedCount: number
    changedCount: number
    tokenDelta: number                   // packB.totalTokens - packA.totalTokens
    packA: {
      id: string
      packCid: string
      totalTokens: number | null
      packType: 'compile' | 'optimized' | 'custom'
      createdAt: string
    }
    packB: {
      id: string
      packCid: string
      totalTokens: number | null
      packType: 'compile' | 'optimized' | 'custom'
      createdAt: string
    }
  }
}
```

**Bucket priority:** an entry that changed CID/compression AND rank goes into `changed`, not `reordered`. Content change is the more specific signal.

**`title`** is included in all buckets. It requires a join to `diary_entries` but that join is already needed to check `entryCidSnapshot` — no extra cost.

**`tokenDelta` in `stats`** is derived from pack metadata (`packB.totalTokens - packA.totalTokens`), not summed from diff rows. This captures the full budget impact including unchanged entries.

**No `budgetUtilization` delta** — packs may have been compiled against different budgets, making a cross-pack utilization ratio misleading.

## Error Cases

| Condition | Status | Message |
|---|---|---|
| Either pack not found | 404 | — |
| Packs in different diaries | 400 | `"Packs must belong to the same diary"` |
| No read access to diary | 403 | — |
| `packCid === otherPackCid` | 200 | Empty diff (all buckets empty, `tokenDelta: 0`) |

The CID equality short-circuit avoids a DB query entirely — pack CIDs are content-addressed, so identical CIDs guarantee identical content.

## Database Query

New `diffPacks(packAId, packBId)` method on `contextPackRepository`. Raw SQL (Drizzle cannot express a self-join `FULL OUTER JOIN` cleanly):

```sql
SELECT
  COALESCE(a.entry_id, b.entry_id)   AS entry_id,
  e.title                             AS title,
  a.rank                              AS old_rank,
  b.rank                              AS new_rank,
  a.entry_cid_snapshot               AS old_cid,
  b.entry_cid_snapshot               AS new_cid,
  a.compression_level                AS old_compression,
  b.compression_level                AS new_compression,
  a.packed_tokens                    AS old_packed_tokens,
  b.packed_tokens                    AS new_packed_tokens,
  CASE
    WHEN a.pack_id IS NULL                                     THEN 'added'
    WHEN b.pack_id IS NULL                                     THEN 'removed'
    WHEN a.entry_cid_snapshot != b.entry_cid_snapshot
      OR a.compression_level  != b.compression_level          THEN 'changed'
    WHEN a.rank != b.rank                                      THEN 'reordered'
    ELSE                                                            'unchanged'
  END                                 AS diff_type
FROM context_pack_entries a
FULL OUTER JOIN context_pack_entries b
  ON a.entry_id = b.entry_id
  AND b.pack_id = $packBId
LEFT JOIN diary_entries e
  ON e.id = COALESCE(a.entry_id, b.entry_id)
WHERE (a.pack_id = $packAId OR b.pack_id = $packBId)
  AND CASE
    WHEN a.pack_id IS NULL                                     THEN 'added'
    WHEN b.pack_id IS NULL                                     THEN 'removed'
    WHEN a.entry_cid_snapshot != b.entry_cid_snapshot
      OR a.compression_level  != b.compression_level          THEN 'changed'
    WHEN a.rank != b.rank                                      THEN 'reordered'
    ELSE                                                            'unchanged'
  END != 'unchanged'
```

**Implementation note:** The `CASE` expression is repeated in the `WHERE` clause to filter unchanged rows. A CTE wrapping the join and computing `diff_type` once is cleaner and avoids the duplication — use that in the actual implementation.

**Index usage:** `context_pack_entries_unique_idx (packId, entryId)` is used on both sides of the join. No new indexes needed.

**Memory:** only diff rows are returned to the application — unchanged entries are filtered in Postgres. For packs with high overlap, this is significantly less data than fetching both entry sets.

## Service Layer

New `diffPacks()` on `contextPackService`:

1. Fetch pack A and pack B in parallel (`getPackById()`). Either missing → 404.
2. CID equality check → return empty diff immediately.
3. Same-diary check: `packA.diaryId !== packB.diaryId` → 400.
4. Authorization: one `permissionChecker` call on `packA.diaryId`. Same diary = same grant.
5. Call `contextPackRepository.diffPacks(packA.id, packB.id)`.
6. One classification pass over rows → bucket into four arrays.
7. Compute `stats` from pack metadata + bucket counts.

## Build Order

This order is mandatory — each step depends on the previous:

1. TypeBox response schema — `apps/rest-api/src/schemas/packs.ts`
2. REST routes — `apps/rest-api/src/routes/packs.ts`
3. OpenAPI spec regeneration — `pnpm run generate:openapi`
4. TS API client regeneration — `libs/api-client`
5. Go API client regeneration — `libs/moltnet-api-client`
6. SDK convenience method (if needed) — `libs/sdk`
7. Repository method — `libs/database/src/repositories/context-pack.repository.ts`
8. Service method — `libs/context-pack-service/src/context-pack.service.ts`
9. MCP tool — `apps/mcp-server/src/pack-tools.ts` + `apps/mcp-server/src/schemas/pack-schemas.ts`
10. Tests at each layer

## Testing Strategy

**Unit tests** (`libs/context-pack-service`):
- CID short-circuit returns empty diff
- Same-diary enforcement (400 path)
- Each bucket in isolation: pure added, pure removed, pure reordered, pure changed
- Mixed case: entries spanning all four buckets
- `tokenDelta` correctness: positive, negative, zero
- Entry with rank change AND CID change → `changed` bucket wins

**Integration tests** (repository, real DB):
- Correct rows for known fixtures
- Full outer join correctness: no overlap (all added/removed), full overlap (all unchanged filtered)
- Null title handled gracefully

**E2E tests** (`apps/rest-api`):
- `GET /packs/:id/diff/:otherId` happy path
- `GET /packs/by-cid/:cid/diff/by-cid/:otherCid` happy path
- 404 when either pack missing
- 400 when packs in different diaries
- 403 when no diary read access
- Empty diff shape when CID equality

No MCP-specific tests — the MCP tool delegates entirely to the REST API via the generated client.

## What This Is Better Than The Issue Proposed

| Issue proposal | This design |
|---|---|
| 3 buckets: added/removed/reordered | 4 buckets: adds `changed` for content/compression drift |
| No entry titles | Titles included (free from join already needed) |
| Token delta only | Token delta + per-pack metadata snapshot (`packA`/`packB`) |
| Application-layer diff (memory) | DB-side classification (only diff rows transferred) |
| ID-only | ID and CID variants |
