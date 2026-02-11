---
date: '2026-02-11T09:00:00Z'
author: claude-opus-4-6
session: unknown
type: handoff
importance: 0.8
tags: [ws3, database, transactions, async-local-storage]
supersedes: null
signature: pending
---

# AsyncLocalStorage Transaction Propagation — Full Implementation

## Context

The after-registration webhook handler (`/hooks/kratos/after-registration`) performs three sequential side effects: voucher redemption, agent upsert, and Keto permission registration. If any step fails after the voucher is consumed, the system is left in an inconsistent state. Issue #137 designed a solution using `AsyncLocalStorage`-based transaction propagation to replace explicit `tx?` parameter threading.

## Substance

Implemented the complete `TransactionRunner` infrastructure from issue #137 — core module, all repository updates, diary service refactoring, hook fix, and tests.

### New module: `libs/database/src/transaction-context.ts`

- `getExecutor(db)` — returns the ALS-stored transaction client or falls back to the base `db`
- `TransactionRunner` interface with `runInTransaction<T>(fn, config?)`
- `createDBOSTransactionRunner(dataSource)` — production implementation wrapping DBOS `DrizzleDataSource`
- `createDrizzleTransactionRunner(db)` — test implementation wrapping plain Drizzle `db.transaction()`

Safe alongside DBOS's internal `AsyncLocalStorage` — separate instances, same underlying Postgres tx client, no cross-reads.

### Repository updates (all repositories)

- `agent.repository.ts` — all methods now use `getExecutor(db)` instead of `db` directly
- `voucher.repository.ts` — `redeem()` now uses `getExecutor(db)`
- `diary.repository.ts` — removed `transaction()` wrapper, removed all `tx?` params, uses `getExecutor(db)`
- `signing-request.repository.ts` — `create()` and `updateStatus()` now use `getExecutor(db)`

No signature changes needed for agent/voucher/signing-request repos. Diary repo had `tx?` params removed since ALS makes them unnecessary.

### Diary service refactoring

- `DiaryServiceDeps` now takes `transactionRunner: TransactionRunner` instead of `dataSource: DataSource`
- `diary-service.ts` uses `transactionRunner.runInTransaction()` for create, delete, and share
- Keto workflows remain outside the transaction (DBOS uses separate system DB — no cross-DB atomicity)
- Removed `DatabaseExecutor` type alias and all `tx?` from `DiaryRepository` interface

### App wiring

- Added `transactionRunner: TransactionRunner` to `AppOptions` and Fastify decorator
- Server bootstrap creates `createDBOSTransactionRunner(dataSource)` after DBOS init
- `transactionRunner` passed to both `registerApiRoutes` and `createDiaryService`

### Hooks handler

The after-registration handler now wraps all side effects in `transactionRunner.runInTransaction()`. If Keto registration fails, the DB transaction rolls back — the voucher stays valid and the agent record is not persisted. Pure validation (public key format/length) stays outside the transaction.

### Tests

- `transaction-context.test.ts` — unit tests for getExecutor, ALS propagation, rollback, cleanup
- `hooks.test.ts` — assertions for transactionRunner.runInTransaction being called, rollback on Keto failure
- `diary-service.test.ts` — updated mocks from DataSource to TransactionRunner
- `diary-service.dbos.integration.test.ts` — uses createDBOSTransactionRunner

## Continuity Notes

Issue #137 is fully implemented. All lint, typecheck (for modified packages), and tests pass.
