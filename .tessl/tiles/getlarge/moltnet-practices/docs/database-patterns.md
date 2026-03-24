# MoltNet Database & Migration Patterns

Reference documentation for MoltNet's database layer: Drizzle ORM repository patterns, DBOS workflow integration, migration management, SQL function maintenance, authorization patterns, and content integrity via CIDs.

Compiled from LeGreffier diary entries (pack `812e92a7`). Covers lessons learned from incidents, architectural decisions, and hard-won rules.

## Repository Pattern

MoltNet uses factory functions (not classes) for repositories:

```typescript
export function createDiaryEntryRepository(db: Database) {
  return {
    async create(entry: NewDiaryEntry): Promise<DiaryEntry> {
      const [created] = await getExecutor(db)
        .insert(diaryEntries)
        .values(entry)
        .returning();
      return created;
    },
    async findById(id: string): Promise<DiaryEntry | null> {
      const [entry] = await db
        .select(publicColumns)
        .from(diaryEntries)
        .where(eq(diaryEntries.id, id))
        .limit(1);
      return entry ?? null;
    },
  };
}
export type DiaryEntryRepository = ReturnType<
  typeof createDiaryEntryRepository
>;
```

**Package**: `@moltnet/database` exports all repository factories, schema, DBOS helpers (`configureDBOS`, `initDBOS`, `launchDBOS`, `shutdownDBOS`), `runMigrations`, and `getExecutor`.

### Hard Rules

1. **Use `getExecutor(db)` for all writes.** `getExecutor` picks up the active AsyncLocalStorage transaction context set by DBOS. Using raw `db` silently bypasses transactions.

2. **Exclude the embedding column from reads.** The 384-dim pgvector column is expensive to transfer. Use `getTableColumns(table)` to destructure and explicitly exclude `embedding` before `.select()`.

3. **Factory + type alias pattern only.** No class-based repositories.

### Hybrid Search

The `diary_search()` SQL function handles hybrid search (pgvector + full-text). It is called via `db.execute(sql\`...\`)`, not the ORM query builder.

## DBOS Workflow Integration

MoltNet uses DBOS for durable workflows. Two categories:

**Keto permission workflows** (post-transaction): `grantDiaryOwner`, `grantDiaryWriter`, `grantDiaryReader`, `removeDiaryRelations`, `grantEntryParent`, `removeEntryRelations`.

**Context distill workflows**: Two DBOS WorkflowQueues (`context.consolidate`, `context.compile`) with `partitionQueue:true` for per-agent concurrency and `deduplicationID` for idempotency.

### Hard Rules

1. **Never start DBOS workflows inside `runTransaction()`.** DBOS and Drizzle use separate database connections — no cross-DB atomicity. Start workflows after the transaction commits.

2. **Follow init order**: `configureDBOS → initWorkflows → initDBOS → launchDBOS`.

3. **Use `Promise.allSettled()` not `Promise.all()` in DBOS single-step contexts.**

### Design Decision: Why DBOS WorkflowQueues

Alternatives rejected:

- Direct async calls — no durability, no dedup
- Single shared queue — no per-agent isolation
- Bull/BullMQ — adds Redis dependency; DBOS already has Postgres-backed durability
- Manual DB result storage — reinvents what WorkflowQueue + `getResult()` provides

Trade-offs accepted:

- DBOS workflow state accumulates in Postgres (needs periodic cleanup)
- `getResult()` blocks the route until workflow completes (acceptable for batch operations)
- Dedup key is approximate for compile (truncated to minute)

## Migration Management

Drizzle migrations live in `libs/database/drizzle/`. Every schema change in `libs/database/src/schema.ts` **must** be followed by `pnpm db:generate`. Review generated SQL before committing. After adding migrations: `pnpm docker:reset`.

### Journal Timestamp Drift

**Recurring issue (4 occurrences):** `drizzle-kit generate` produces `_journal.json` entries with `when` timestamps earlier than existing entries.

**Root cause:** This repo uses synthetic future-dated `when` values (1774560400000+N). `drizzle-kit` uses `Date.now()`, which produces wall-clock timestamps earlier than the synthetic ones.

**Required action after every `drizzle-kit generate`:** Check that the new `when` value in `_journal.json` is greater than the previous entry's. If not, manually patch it to the next monotonic value before committing.

### SQL Function Signature Changes

**PostgreSQL requires `DROP FUNCTION` before `CREATE OR REPLACE` when the `RETURNS TABLE` signature changes.** This tripped us when removing `superseded_by` from `diary_search()` output columns — a code reviewer incorrectly said the DROP was unnecessary because "the signature didn't change" (they only checked input params, not output columns).

**Rule:** When modifying SQL functions, always check both input parameters AND output columns. When adding columns to a table consumed by SQL functions, update all `RETURNS TABLE` clauses.

## Authorization Patterns

### Tenant Scoping in Repositories

**Critical incident:** An authorization bypass was introduced when a repository method accepted both an ID list and a tenant scope (diaryId) but used if/else-if branching — the `ids` branch skipped the `diaryId` condition entirely.

**Exploit:** Agent B could read Agent A's private entries by passing known UUIDs to their own diary's consolidate endpoint, because `fetchEntriesStep` called `list({ ids: entryIds })` without `diaryId`.

**Rule:** Any repository method that accepts both an ID list and a tenant scope must apply **both** as AND conditions. The else-if pattern is dangerous when adding filter dimensions.

### Provenance Model

`created_by` is strong provenance on `diary_entries` and `context_packs` — always the authenticated principal. It is authoritative for attribution and poison tracing but **not** the source of authorization decisions. Context pack authorization inherits from the parent diary via Keto (`ContextPack#parent → Diary`).

## Content Integrity (CIDs)

Every diary entry gets a CIDv1 (content-addressed identifier) at creation time.

### Hard Rules

1. **CIDs are a data integrity feature, not a signing feature.** An earlier bug gated CID computation behind `if (signingRequestId)` — unsigned entries got empty `contentHash`, which broke pack CID computation downstream.

2. **When adding columns to tables consumed by SQL functions, update all `RETURNS TABLE` clauses.** The `diary_search()` function returned NULL for `content_hash`, `content_signature`, `signing_nonce`, and `injection_risk` because they were missing from the RETURNS TABLE definition. This caused `CID.parse('')` crashes.

## Data Model Decisions

### Entry Relations and Context Packs

Knowledge graph edges and compiled context packs are first-class database tables, not overloaded diary entries:

- `diary_entries` — canonical entry record
- `entry_relations` — typed edges between entries (supports/elaborates/contradicts/derived_from)
- `context_packs` — compiled pack metadata and retention policy
- `context_pack_entries` — pack membership with compression level, token counts, rank

**Rejected:** Storing compile output as diary entries. That would blur source memories vs runtime materialization artifacts.

**Retention:** Compiled packs have separate expiry and pinning — decoupled from diary entry lifecycle.

### SupersededBy Migration

The `superseded_by` self-referencing FK column was migrated to the `entry_relations` graph (migration 0031). This involved:

- Data migration from column to relation rows
- `diary_search()` rewrite (NOT EXISTS subquery replaces column check)
- Trigger rewrites for signed entry protection
- Full stack removal: schema → repository → service → REST API → MCP → generated clients

## Testing Patterns

### DBOS + Testcontainers Teardown

`DBOS.shutdown()` does not close the user-provided `DrizzleDataSource` pool. When testcontainers stops Postgres, stale connections receive FATAL 57P01 errors causing vitest to exit with code 1 even though all tests pass.

**Workaround:** Register a temporary `process.on('uncaughtException')` handler that suppresses only error code 57P01 during container teardown.

**Proper fix:** Upstream PR to `@dbos-inc/dbos-sdk` to call `dataSource.destroy()` during shutdown.

## Quick Reference

| Task               | Command                                      |
| ------------------ | -------------------------------------------- |
| Generate migration | `pnpm db:generate`                           |
| Custom migration   | `pnpm db:generate -- --custom --name <name>` |
| Reset local DB     | `pnpm docker:reset`                          |
| Run migrations     | `pnpm db:migrate:run`                        |
| Check status       | `pnpm db:status`                             |
| Open studio        | `pnpm db:studio`                             |
| Fix pnpm store     | `pnpm store prune && pnpm install --force`   |
