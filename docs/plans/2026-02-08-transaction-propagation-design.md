# Transaction Propagation with AsyncLocalStorage

**Date**: 2026-02-08
**Status**: Design
**Scope**: `libs/database`, `libs/diary-service`, `apps/rest-api`, `apps/server`

## Problem

Transaction propagation in MoltNet is currently explicit: every repository method accepts `tx?: Database`, and the service layer manually threads either `dataSource.client` (DBOS path) or `tx` (fallback path) through each call. This creates four problems:

1. **Boilerplate** — every repository method has `tx?: Database` + `const executor = tx ?? db`
2. **Cross-service transactions** — composing multiple repositories in one transaction requires plumbing `tx` through every call
3. **DBOS compatibility** — two separate transaction APIs (`dataSource.runTransaction` vs `db.transaction`) with different client passing conventions
4. **Correctness risk** — forgetting to pass `tx` silently runs the query outside the transaction

Additionally, the service layer has a dual-path pattern (`if (dataSource)` / `else`) that should be eliminated by making DBOS mandatory.

## Design

### Core: AsyncLocalStorage-based Transaction Context

A new module `libs/database/src/transaction-context.ts` (~60 lines) that uses `AsyncLocalStorage` to store the active transaction client. Repositories retrieve it implicitly instead of accepting explicit parameters.

This is safe alongside DBOS's internal `AsyncLocalStorage` usage — each `AsyncLocalStorage` instance maintains an independent storage slot. Both end up pointing to the same underlying Postgres transaction client.

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Database } from './db.js';

const txStorage = new AsyncLocalStorage<Database>();

/**
 * Get the active transaction executor.
 * Returns the ALS-stored tx client if inside a transaction,
 * otherwise returns the provided db fallback.
 */
export function getExecutor(db: Database): Database {
  return txStorage.getStore() ?? db;
}
```

### TransactionRunner Interface

An abstraction over transaction execution that both DBOS and plain Drizzle can implement:

```typescript
export interface TransactionRunner {
  runInTransaction<T>(
    fn: () => Promise<T>,
    config?: { name?: string },
  ): Promise<T>;
}
```

**DBOS implementation** (production):

```typescript
export function createDBOSTransactionRunner(
  dataSource: DrizzleDataSource<DBOSDatabase>,
): TransactionRunner {
  return {
    async runInTransaction<T>(fn: () => Promise<T>, config?) {
      return dataSource.runTransaction(
        () => txStorage.run(dataSource.client as unknown as Database, fn),
        config,
      );
    },
  };
}
```

**Plain Drizzle implementation** (unit tests):

```typescript
export function createDrizzleTransactionRunner(
  db: Database,
): TransactionRunner {
  return {
    async runInTransaction<T>(fn: () => Promise<T>, config?) {
      return db.transaction((tx) =>
        txStorage.run(tx as unknown as Database, fn),
      );
    },
  };
}
```

### Why Dual ALS is Safe

DBOS's `DrizzleDataSource` already uses `AsyncLocalStorage` internally to store the transaction client for `dataSource.client` access. Our `txStorage` is a separate `AsyncLocalStorage` instance.

Inside a DBOS transaction:

```
dataSource.runTransaction(() => {
  // DBOS internal ALS: { client: pgTx, owner: handler }
  // Our txStorage:     (not set)

  txStorage.run(dataSource.client, async () => {
    // DBOS internal ALS: { client: pgTx, owner: handler }  (unchanged)
    // Our txStorage:     pgTx  (same object)

    getExecutor(db)  // returns pgTx from our txStorage
  });
});
```

- Different `AsyncLocalStorage` instances = different storage keys
- Both hold the same Drizzle tx object — no divergence
- DBOS reads its ALS via `dataSource.client`; repositories read ours via `getExecutor()` — no cross-reads
- Nesting `withTransaction` inside DBOS creates a savepoint (correct Postgres behavior)

## Changes Required

### Repository Layer

**Files**: `libs/database/src/repositories/diary.repository.ts`, `voucher.repository.ts`, any others with `tx?` parameters.

- Remove `tx?: Database` parameter from all methods
- Remove `const executor = tx ?? db` pattern — replace with `getExecutor(db)`
- Remove `transaction<T>(fn)` wrapper methods (service layer owns transaction boundaries)
- Import `getExecutor` from `./transaction-context.js`

Before:

```typescript
async create(entry: NewDiaryEntry, tx?: Database): Promise<DiaryEntry> {
  const executor = tx ?? db;
  const [created] = await executor.insert(diaryEntries).values(entry).returning();
  return created;
}
```

After:

```typescript
async create(entry: NewDiaryEntry): Promise<DiaryEntry> {
  const [created] = await getExecutor(db).insert(diaryEntries).values(entry).returning();
  return created;
}
```

### Service Layer

**Files**: `libs/diary-service/src/diary-service.ts`, `libs/diary-service/src/types.ts`

- `DiaryServiceDeps.dataSource` becomes `transactionRunner: TransactionRunner` (non-optional)
- Remove all `if (dataSource)` / `else` branching
- All mutating operations use `transactionRunner.runInTransaction()`
- Repository calls lose the `tx` / `dataSource.client` argument

Before:

```typescript
if (dataSource) {
  return dataSource.runTransaction(
    async () => {
      const entry = await diaryRepository.create(entryData, dataSource.client);
      await DBOS.startWorkflow(ketoWorkflows.grantOwnership)(
        entry.id,
        input.ownerId,
      );
      return entry;
    },
    { name: 'diary.create' },
  );
}
return diaryRepository.transaction(async (tx) => {
  const entry = await diaryRepository.create(entryData, tx);
  await permissionChecker.grantOwnership(entry.id, input.ownerId);
  return entry;
});
```

After:

```typescript
return transactionRunner.runInTransaction(
  async () => {
    const entry = await diaryRepository.create(entryData);
    await DBOS.startWorkflow(ketoWorkflows.grantOwnership)(
      entry.id,
      input.ownerId,
    );
    return entry;
  },
  { name: 'diary.create' },
);
```

### App Bootstrap

**Files**: `apps/rest-api/src/app.ts`, `apps/server/src/app.ts`

- Create `TransactionRunner` via `createDBOSTransactionRunner(dataSource)`
- Pass `transactionRunner` to service factories
- DBOS initialization is mandatory — fail startup if not configured

### DBOS Plugin

**File**: `apps/rest-api/src/plugins/dbos.ts`

- Remove conditional registration — DBOS is always required
- Failure to initialize = app won't start

### Tests

- **Unit tests**: `createDrizzleTransactionRunner(db)` + mock `DBOS.startWorkflow`
- **Integration/e2e tests**: real DBOS runtime

### Unchanged

- MCP server (uses REST API client, no local DB)
- Database schema, migrations, Drizzle config
- Keto workflows registration and DBOS initialization order
- DBOS workflow/step definitions

## Data Flow

```
Service.create(input)
  |
  v
transactionRunner.runInTransaction(async () => {
  |
  |  [ALS context set: txStorage -> active tx client]
  |
  +---> diaryRepository.create(entryData)
  |       |
  |       +---> getExecutor(db)        // returns tx from ALS
  |       +---> executor.insert(...)   // runs inside transaction
  |
  +---> DBOS.startWorkflow(ketoWorkflows.grantOwnership)(entry.id, ownerId)
  |       // scheduled inside same Postgres tx = atomic commit
  |
  v
  return entry
})
```

## Exports from `libs/database`

New public API additions:

```typescript
// transaction-context.ts
export { getExecutor } from './transaction-context.js';
export type { TransactionRunner } from './transaction-context.js';
export { createDBOSTransactionRunner } from './transaction-context.js';
export { createDrizzleTransactionRunner } from './transaction-context.js';
```

## References

- [Drizzle ORM transactions](https://orm.drizzle.team/docs/transactions)
- [drizzle-orm#543 — AsyncLocalStorage proposal](https://github.com/drizzle-team/drizzle-orm/issues/543)
- [drizzle-orm#1473 — Transaction propagation](https://github.com/drizzle-team/drizzle-orm/issues/1473)
- [drizzle-transaction-context](https://github.com/nickdeis/drizzle-transaction-context) — similar approach (not used, custom impl preferred for DBOS compatibility)
- DBOS `DrizzleDataSource` source — confirms internal `AsyncLocalStorage` usage
