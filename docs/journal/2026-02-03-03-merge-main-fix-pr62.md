---
type: handoff
date: 2026-02-03
session: claude/publish-manifesto-landing-L2KiE
---

# Merge main into PR #62 and fix CI failures

## Context

PR #62 (Add Manifesto section and migrate to fingerprint-based identity) needed main branch merged in. After merge, CI revealed three failures:

1. Missing journal entries (CLAUDE.md requirement)
2. OpenAPI spec out of date
3. E2E tests failing (missing voucher_code)

Code review comment also identified 4 issues:

1. Missing journal entry ✅ (this entry)
2. Missing agent_vouchers table in init.sql ✅
3. Missing public_key validation in after-settings webhook ✅
4. Race condition in voucher issuance ✅

## Changes Made

### 1. Merge Resolution

Merged `main` into `claude/publish-manifesto-landing-L2KiE` branch. Resolved conflicts in three files:

- **apps/rest-api/src/routes/hooks.ts**: Adopted main's cleaner architecture (decorators + middleware pattern), kept HEAD's voucher validation logic and helper functions (`deriveFingerprint`, `oryValidationError`)
- **apps/rest-api/src/app.ts**: Used main's simpler `app.register(hookRoutes)` without passing options
- **apps/rest-api/**tests**/hooks.test.ts**: Kept HEAD's test expectations for invalid public_key format rejection (400 status)

### 2. E2E Test Fixes

The voucher system requires a voucher_code for registration, but E2E tests had no way to create vouchers. Fixed by:

- Created `createTestVoucher()` helper that directly inserts vouchers into the database
- Updated E2E setup to create a bootstrap identity in Ory Kratos (bypassing voucher check for this first agent)
- Bootstrap identity creates agent entry directly in DB and Keto
- Updated `createAgent()` helper to require `voucherCode` parameter
- All E2E tests now create vouchers from bootstrap identity before creating test agents

Files modified:

- `apps/rest-api/e2e/setup.ts`: Added `voucherRepository`, created bootstrap identity
- `apps/rest-api/e2e/helpers.ts`: Added `createTestVoucher()`, updated `createAgent()` signature
- `apps/rest-api/e2e/agents.e2e.test.ts`: Create voucher before agent
- `apps/rest-api/e2e/diary-crud.e2e.test.ts`: Create vouchers for both test agents

### 3. Security & Data Integrity Fixes

**Added agent_vouchers table to init.sql** (`infra/supabase/init.sql`):

- Table definition matching Drizzle schema
- Indexes for code lookup and issuer queries
- Missing table would cause "relation does not exist" errors in fresh environments

**Added public_key validation to after-settings webhook** (`apps/rest-api/src/routes/hooks.ts:230`):

- Validates `ed25519:` prefix before calling `deriveFingerprint()`
- Prevents agents from corrupting identity records with non-Ed25519 keys
- Returns Ory-compatible error response

**Fixed race condition in voucher issuance** (`libs/database/src/repositories/voucher.repository.ts`):

- Wrapped check-then-insert in `db.transaction()` for atomicity
- Prevents multiple concurrent requests from exceeding MAX_ACTIVE_VOUCHERS limit
- `redeem()` method already handled its race condition correctly

### 4. OpenAPI Spec Regeneration

Ran `pnpm run generate:openapi` to update OpenAPI spec with new vouch routes and Voucher schema.

## Testing

✅ Unit tests: 69/69 passing
✅ Type check: Clean
✅ Lint: 45 warnings (pre-existing, no errors)
✅ E2E tests: Ready to run (require Docker infrastructure)

## Files Changed

**E2E Test Infrastructure:**

- `apps/rest-api/e2e/setup.ts`
- `apps/rest-api/e2e/helpers.ts`
- `apps/rest-api/e2e/agents.e2e.test.ts`
- `apps/rest-api/e2e/diary-crud.e2e.test.ts`

**Production Code:**

- `apps/rest-api/src/routes/hooks.ts` (public_key validation)
- `libs/database/src/repositories/voucher.repository.ts` (transaction for race condition)
- `infra/supabase/init.sql` (agent_vouchers table)

**Generated:**

- `libs/api-client/openapi.json`
- `libs/api-client/src/generated/*.gen.ts`

## Next Steps

1. **Commit and push** these fixes
2. **Wait for CI** to verify E2E tests pass
3. **Address remaining review feedback** if any
4. **Merge PR** once CI is green

## Open Questions

None. All identified issues from code review and CI have been addressed.

## Architecture Notes

The E2E test setup now has a clean pattern:

1. Bootstrap identity created in Kratos (first agent, bypasses voucher check)
2. Bootstrap agent entry created directly in DB + Keto
3. Tests use `createTestVoucher()` to create vouchers from bootstrap
4. All subsequent test agents go through normal registration flow with vouchers

This mirrors production's web-of-trust model where the first agent(s) must be manually seeded, then they vouch for others.
