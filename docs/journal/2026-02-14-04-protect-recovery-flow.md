---
date: '2026-02-14T21:00:00Z'
author: claude-opus-4-6
session: protect-recovery-flow-76
type: handoff
importance: 0.8
tags: [security, recovery, anti-enumeration, replay-prevention, ws6]
supersedes: null
signature: <pending>
---

# Protect Recovery Flow — Security Hardening

## Context

Issue #76 required four security hardening measures for the `/recovery/challenge` and `/recovery/verify` endpoints: anti-enumeration, nonce replay prevention, input constraints, and brute-force logging.

## Substance

### Anti-enumeration (challenge endpoint)

The challenge endpoint previously returned 404 for unknown public keys, which allowed attackers to enumerate valid agent public keys. Now it always generates and returns a valid challenge+HMAC regardless of whether the key exists in the database. Unknown keys will fail silently at `/verify` — the failure is indistinguishable from a wrong signature.

### Nonce replay prevention

Added a `used_recovery_nonces` database table with nonce (PK) and expiry timestamp. After HMAC validation succeeds in the verify handler, the nonce is extracted from the challenge string (parts[4]) and consumed via `INSERT ... ON CONFLICT DO NOTHING`. If the nonce was already used, the request is rejected with `invalid-challenge` / "Challenge already used". The repository also exposes a `cleanup()` method for periodic expiry sweeps.

### Input constraints

Added `MAX_PUBLIC_KEY_LENGTH = 60` (8 char prefix + ~44 base64 chars + margin) and applied `maxLength` to both `publicKey` fields in the challenge and verify request schemas.

### Brute-force logging

All failure paths now emit structured warn logs with `requestId`, `ip`, and `publicKey` (or `fingerprint` when available). Covered: HMAC failure, nonce replay, unknown key at verify, signature failure.

## Files Changed

- `libs/database/src/schema.ts` — added `usedRecoveryNonces` table
- `libs/database/src/repositories/nonce.repository.ts` — new repository (consume, cleanup)
- `libs/database/src/index.ts` — export new repository
- `libs/database/drizzle/0005_black_gamora.sql` — migration
- `apps/rest-api/src/schemas.ts` — added `MAX_PUBLIC_KEY_LENGTH`
- `apps/rest-api/src/routes/recovery.ts` — all four hardening measures
- `apps/rest-api/src/app.ts` — wired `nonceRepository` through options
- `apps/rest-api/src/types.ts` — re-exported `NonceRepository`
- `apps/server/src/app.ts` — wired `nonceRepository` in bootstrap
- `apps/rest-api/__tests__/helpers.ts` — added mock
- `apps/rest-api/__tests__/recovery.test.ts` — updated + new tests
- `libs/database/__tests__/nonce.repository.test.ts` — new test file
- `apps/server/e2e/recovery.e2e.test.ts` — updated for anti-enumeration

## Continuity Notes

- All 230 unit tests pass (52 database + 178 rest-api)
- The `@fastify/type-provider-typebox` module resolution issue causes pre-existing eslint `no-unsafe-argument` errors across all route files — not introduced by this PR
- The `cleanup()` method on `NonceRepository` is not yet called anywhere on a schedule. A future task should add a periodic cleanup (e.g., Fastify interval or cron) to sweep expired nonces
- E2E tests updated but not run (require Docker Compose)
- Migration `0005_black_gamora.sql` needs `pnpm docker:reset` locally after merge
