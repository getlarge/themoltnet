---
date: '2026-02-06T15:30:00Z'
author: claude-opus-4-6
session: unknown
type: handoff
importance: 0.7
tags: [handoff, voucher, concurrency, race-condition, database]
supersedes: null
signature: pending
---

# Handoff: Voucher Redemption Race Condition Fix (#79)

## What Was Done This Session

- **Fixed `redeem()` TOCTOU race** in `voucher.repository.ts`: Replaced the SELECT-then-UPDATE pattern with a single atomic `UPDATE...WHERE...RETURNING`. Postgres row-level locking ensures only one concurrent caller can win the voucher. The old pattern did a SELECT to find a valid voucher, then a separate UPDATE to claim it — between those two statements, another caller could claim the same voucher.

- **Added SERIALIZABLE isolation to `issue()`**: The `issue()` method uses a transaction to enforce the max-5 active vouchers invariant, but at the default READ COMMITTED isolation level, two concurrent `issue()` calls could both read 4 active vouchers and both insert, reaching 6. Added `{ isolationLevel: 'serializable' }` to the transaction config so Postgres detects the anomaly and aborts one of the concurrent transactions.

- **Added serialization failure retry in `POST /vouch` route**: SERIALIZABLE transactions can throw Postgres error 40001 (serialization_failure) under contention. The route handler now retries up to 3 times, catching only 40001 errors. Non-serialization errors propagate immediately.

- **Added unit tests for voucher repository**: 10 tests covering issue, redeem (verifies single UPDATE with no SELECT), findByCode, listActiveByIssuer, and serializable isolation level verification.

- **Added integration tests for voucher repository**: 14 tests (gated on `DATABASE_URL`) covering CRUD, concurrent redemption (only one winner), concurrent issuance (max-5 holds), and expired voucher handling.

- **Added serialization retry unit tests**: 3 tests in `vouch.test.ts` for the retry logic: succeeds on second attempt, rethrows after max retries, doesn't retry non-serialization errors.

- **Added concurrent voucher e2e tests**: Two new test sections in `concurrency.e2e.test.ts`: concurrent `POST /vouch` issuance (max-5 invariant at HTTP level) and concurrent voucher redemption via the after-registration webhook (two agents racing for the same voucher code).

## What's Not Done Yet

- The `redeem()` fix doesn't need caller-side retry since the atomic UPDATE handles concurrency via row locking (no serialization errors possible).
- The e2e tests require Docker infrastructure to run (`docker compose --profile dev up -d --wait`).

## Current State

- Branch: `claude/fix-voucher-race-condition-79`
- Tests: 111 rest-api tests passing (+3), 29 database unit tests passing (+10), integration tests skipped without `DATABASE_URL`
- Typecheck: clean
- Lint: 0 errors (only pre-existing warnings)

## Decisions Made

- **Single atomic UPDATE over SELECT-then-UPDATE for `redeem()`**: The old pattern's re-check in the UPDATE WHERE clause was a partial mitigation, but the initial SELECT was wasted work and the pattern was fragile. The atomic UPDATE is strictly better.
- **SERIALIZABLE over advisory locks for `issue()`**: Advisory locks would work but add operational complexity. SERIALIZABLE is the standard Postgres mechanism for this and works with Drizzle's transaction API.
- **Retry in the route handler, not the repository**: The repository is a data access layer; retry policy is a business concern that belongs in the route. The repository throws the serialization error and lets the caller decide.
- **3 max retries**: Serialization failures under normal load should resolve on the first retry. Three attempts is generous enough for bursts without masking systemic issues.

## Where to Start Next

1. Review the PR and merge
2. The concurrent e2e tests can be validated by running with Docker infrastructure up
3. Consider whether other SERIALIZABLE transactions in the codebase need similar retry wrappers
