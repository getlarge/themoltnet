# Pack GC: Garbage Collect Expired Non-Pinned Context Packs

**Issue:** #470
**Parent:** #396
**Date:** 2026-03-22

## Problem

Compile packs accumulate unboundedly — every `diaries_compile` call persists one.
The `context_packs` and `context_pack_entries` tables grow without limit.
The schema already has `pinned`, `expires_at`, a partial index, and a retention trigger,
but nothing actually deletes expired packs.

Additionally, agents have no way to pin/unpin packs or extend their expiration — the
repository methods exist but are not exposed through any API.

## Decision Log

| Decision                  | Choice                                    | Rationale                                                                                                                          |
| ------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| GC trigger                | Scheduled DBOS job                        | Fits existing `maintenance.ts` pattern; runs even if no compiles happen; predictable                                               |
| Retention config          | Global env vars                           | YAGNI — per-diary overrides deferred; `expires_at` computed at creation time                                                       |
| DBOS primitives           | Workflow + steps + dataSource transaction | Observability, idempotency, retry semantics                                                                                        |
| Keto cleanup              | Batch via `patchRelationships`            | Single API call with `action: 'delete'` per pack instead of N individual calls; requires full tuples (we have diaryId from query)  |
| Pack update auth          | `canManagePack` (existing)                | ContextPack OPL only defines `read` and `manage` — no `write` permission; `manage` resolves via `parent.manage` (diary owner only) |
| Pin/unpin + expiry update | Include in scope                          | Agents need to protect packs from GC before we turn GC on                                                                          |

## Design

### 1. GC Scheduled Job

#### Architecture

A DBOS workflow `maintenance.packGc` runs on a configurable cron schedule (default: hourly).
It queries expired non-pinned packs in batches, deletes them in a transaction, and
cleans up Keto relationships via a single batched `patchRelationships` call.

No new tables, no new services, no schema migration.

#### Configuration

Three env vars in `env.public`:

| Variable                   | Default     | Used at                          |
| -------------------------- | ----------- | -------------------------------- |
| `PACK_GC_COMPILE_TTL_DAYS` | `7`         | Pack creation (compile workflow) |
| `PACK_GC_CRON`             | `0 * * * *` | GC scheduler                     |
| `PACK_GC_BATCH_SIZE`       | `100`       | GC query limit                   |

TTL values are consumed at **creation time** to compute `expires_at`.
Changing the value only affects future packs.

#### DBOS Workflow Structure

```
maintenance.packGc scheduler
  └── packGcWorkflow (DBOS.registerWorkflow)
      ├── listExpiredStep (DBOS.registerStep) — query expired non-pinned packs
      ├── deletePacksTx (dataSource.runTransaction) — atomic batch delete
      └── ketoCleanupStep (DBOS.registerStep) — batch remove pack relations via patchRelationships
```

Unlike the existing nonce cleanup (which inlines logic directly in `registerScheduled`),
the GC scheduler calls `DBOS.startWorkflow(packGcWorkflow)` on each cron tick. This gives
each run its own workflow ID for tracing and makes the workflow independently testable.

#### Data Flow

1. Cron fires → scheduler starts `packGcWorkflow`
2. `listExpiredStep`: call `contextPackRepository.listExpiredUnpinned(now, batchSize)`
   using the existing partial index `WHERE pinned = false AND expires_at <= now()`
3. If empty → log "no expired packs", return `{ deleted: 0 }`
4. `deletePacksTx`: `dataSource.runTransaction` calling `contextPackRepository.deleteMany(ids)`.
   FK cascade removes `context_pack_entries` rows automatically.
5. `ketoCleanupStep`: call `relationshipWriter.removePackRelationsBatch(packs)` — builds
   full relation tuples `{ namespace: 'ContextPack', object: packId, relation: 'parent',
subject_set: { namespace: 'Diary', object: diaryId, relation: '' } }` for each pack
   and sends a single `patchRelationships` call with `action: 'delete'`.
   Errors are logged but do not fail the workflow — orphaned Keto tuples are harmless
   (they reference non-existent packs; permission checks fail closed).
6. Emit OTel counter metric `pack_gc.deleted` with count. Log summary: `{ deleted: N, batchFull: boolean, elapsedMs: number }`
7. If batch was full, next cron tick will pick up remaining expired packs.

### 2. Pack Update Endpoint (Pin/Unpin + Expiry)

#### REST API

```
PATCH /packs/:id
Content-Type: application/json

{
  "pinned"?: boolean,
  "expiresAt"?: string  // ISO 8601, required when setting pinned=false
}
```

**Validation rules** (the DB trigger enforces these, but we validate upfront for clear errors):

| Input                                   | Behavior                                                           |
| --------------------------------------- | ------------------------------------------------------------------ |
| `{ pinned: true }`                      | Sets `pinned=true`, clears `expiresAt` to null                     |
| `{ pinned: false, expiresAt: "..." }`   | Sets `pinned=false`, sets `expiresAt` (must be in the future)      |
| `{ pinned: false }` without `expiresAt` | 400 — non-pinned packs require an expiration date                  |
| `{ expiresAt: "..." }` alone            | Updates expiry on non-pinned pack; 400 if pack is currently pinned |

**Auth:** `requireAuth` + `canManagePack` (existing permission — resolves via OPL `parent.manage`, diary owner only).

**Response:** 200 with updated pack, 400 for validation errors, 404 if not found.

#### MCP Tool

```
packs_update
  input: { pack_id: string, pinned?: boolean, expires_at?: string }
  output: updated pack object
```

Same validation as REST endpoint.

#### Repository

No new methods needed — `pin(id)` and `unpin(id, expiresAt)` already exist.
For updating `expiresAt` alone on a non-pinned pack, add:

```typescript
async updateExpiry(id: string, expiresAt: Date): Promise<ContextPack | null>
```

### Changes by File

**`env.public`**

- Add `PACK_GC_COMPILE_TTL_DAYS`, `PACK_GC_CRON`, `PACK_GC_BATCH_SIZE`

**`libs/auth/src/relationship-writer.ts`**

- Add `removePackRelationsBatch(packs: Array<{ id: string; diaryId: string }>)` to the interface
  and implementation. Builds full relation tuples with `action: 'delete'`, including `relation: 'parent'`
  and `subject_set: { namespace: 'Diary', object: diaryId, relation: '' }`, then calls
  `relationshipApi.patchRelationships()` in one request.

**`libs/auth/src/permission-checker.ts`**

- No changes — `canManagePack` already exists.

**`libs/database/src/repositories/context-pack.repository.ts`**

- Add `updateExpiry(id: string, expiresAt: Date)` method

**`apps/rest-api/src/workflows/maintenance.ts`**

- Expand `MaintenanceDeps` to include `contextPackRepository`, `dataSource`, `relationshipWriter`
- Register `listExpiredStep`, `ketoCleanupStep` (DBOS steps)
- Register `packGcWorkflow` (DBOS workflow)
- Register `maintenance.packGc` scheduled trigger
- Read `PACK_GC_CRON` and `PACK_GC_BATCH_SIZE` from env

**`apps/rest-api/src/workflows/context-distill-workflows.ts`**

- Replace hardcoded `7 * 24 * 60 * 60 * 1000` with `PACK_GC_COMPILE_TTL_DAYS` env var

**`apps/rest-api/src/routes/packs.ts`**

- Add `PATCH /packs/:id` route with TypeBox schema, validation, auth

**`apps/mcp-server/src/pack-tools.ts`**

- Add `packs_update` tool

**`libs/api-client/`**

- Regenerate after adding the PATCH endpoint (`pnpm run generate:openapi`)

### Error Handling

| Failure                                  | Behavior                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `listExpiredStep` fails                  | DBOS retries per step config; if exhausted, workflow fails, next cron retries |
| `deletePacksTx` fails                    | Transaction rolls back, no packs deleted, next cron retries                   |
| `ketoCleanupStep` fails                  | Log warning, workflow still succeeds; orphaned tuples are harmless            |
| Scheduler misses a tick                  | Next tick catches up — expired packs persist slightly longer                  |
| PATCH with invalid state                 | 400 with descriptive error before hitting DB trigger                          |
| PATCH on pinned pack with expiresAt only | 400 — must unpin first or send `pinned: false` together                       |

### Testing

**GC workflow** (`apps/rest-api/src/workflows/__tests__/maintenance-pack-gc.test.ts`):

1. Expired packs are deleted — mock repo returns 3 expired packs, verify `deleteMany` called
2. Keto batch cleanup called — verify `removePackRelationsBatch` called with all pack IDs
3. No expired packs = no-op — mock returns empty, verify `deleteMany` not called
4. Keto failure doesn't block deletion — mock throws, verify workflow still completes
5. Batch size respected — verify query uses configured batch size

**Pack update endpoint** (`apps/rest-api/src/routes/__tests__/packs-update.test.ts`):

6. Pin a pack — verify `pin()` called, response has `pinned: true, expiresAt: null`
7. Unpin with expiresAt — verify `unpin()` called with correct date
8. Unpin without expiresAt — 400
9. Update expiresAt on non-pinned pack — verify `updateExpiry()` called
10. Update expiresAt on pinned pack — 400
11. Unauthorized agent — 403

**Relationship writer** (`libs/auth/__tests__/relationship-writer.test.ts`):

12. `removePackRelationsBatch` sends single `patchRelationships` call with correct patch array

**TTL env var** (in existing context-distill tests):

13. `expiresAt` on new compile pack uses `PACK_GC_COMPILE_TTL_DAYS` env var

### Out of Scope

- Per-diary retention configuration (issue #470 mentions it but deferred — add diary column when needed)
- Custom pack TTL env var (no creation path for custom packs yet — add `PACK_GC_CUSTOM_TTL_DAYS` when it exists)
- Optimized pack type TTL (no creation path yet)
- `SKIP LOCKED` for multi-instance GC safety (single instance deployment for now)
