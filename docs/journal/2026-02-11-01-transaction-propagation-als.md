---
date: '2026-02-11T09:00:00Z'
author: claude-opus-4-6
session: unknown
type: progress
importance: 0.7
tags: [ws3, database, transactions, async-local-storage]
supersedes: null
signature: pending
---

# AsyncLocalStorage Transaction Propagation — Core Infrastructure

## Context

The after-registration webhook handler (`/hooks/kratos/after-registration`) performs three sequential side effects: voucher redemption, agent upsert, and Keto permission registration. If any step fails after the voucher is consumed, the system is left in an inconsistent state. Issue #137 designed a solution using `AsyncLocalStorage`-based transaction propagation to replace explicit `tx?` parameter threading.

## Substance

Implemented the core `TransactionRunner` infrastructure and applied it to the registration hook:

### New module: `libs/database/src/transaction-context.ts`

- `getExecutor(db)` — returns the ALS-stored transaction client or falls back to the base `db`
- `TransactionRunner` interface with `runInTransaction<T>(fn, config?)`
- `createDBOSTransactionRunner(dataSource)` — production implementation wrapping DBOS `DrizzleDataSource`
- `createDrizzleTransactionRunner(db)` — test implementation wrapping plain Drizzle `db.transaction()`

Safe alongside DBOS's internal `AsyncLocalStorage` — separate instances, same underlying Postgres tx client, no cross-reads.

### Repository updates

- `agent.repository.ts` — all methods now use `getExecutor(db)` instead of `db` directly
- `voucher.repository.ts` — `redeem()` now uses `getExecutor(db)`

No signature changes — the ALS approach is transparent to existing callers. Methods automatically participate in any active transaction.

### App wiring

- Added `transactionRunner: TransactionRunner` to `AppOptions` and Fastify decorator
- Server bootstrap creates `createDBOSTransactionRunner(dataSource)` after DBOS init

### Hooks handler

The after-registration handler now wraps all side effects in `transactionRunner.runInTransaction()`. If Keto registration fails, the DB transaction rolls back — the voucher stays valid and the agent record is not persisted. Pure validation (public key format/length) stays outside the transaction.

## Continuity Notes

This implements the first part of issue #137. Remaining tasks:

- Refactor `diary.repository.ts` — remove `tx?` params, use `getExecutor(db)` (breaking change for diary service)
- Refactor `diary-service.ts` — replace `dataSource?` dual-path with single `transactionRunner.runInTransaction()` path
- Make DBOS mandatory (remove fallback path in diary service)
- Update `signing-request.repository.ts` to use `getExecutor(db)`
- Add integration tests for ALS propagation with real DBOS + Postgres
