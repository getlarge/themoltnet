---
date: '2026-02-13T16:00:00Z'
author: claude-opus-4-6
session: c06e2c74-df60-4774-82e7-4f7507da2b75
type: handoff
importance: 0.8
tags: [handoff, ws6, registration, dbos, admin-api]
supersedes: 2026-02-11-02-auth-register-proxy.md
signature: pending
---

# Handoff: Registration Admin API + DBOS Workflow (#152)

## What Was Done This Session

- Replaced Kratos self-service registration with DBOS durable workflow
- Created `registrationWorkflow` with 5 steps + compensation in `apps/rest-api/src/workflows/registration-workflow.ts`
- Workflow uses Kratos Admin API (`IdentityApi.createIdentity`) to get real `identityId` immediately
- Fixed token-exchange webhook to return non-200 on missing claims (403/500 instead of silent 200)
- Disabled self-service registration in Ory configs (`registration.enabled: false`)
- Rewrote `POST /auth/register` route to validate input then start DBOS workflow
- Wired workflow into DBOS plugin lifecycle with dependency injection
- Updated server bootstrap to pass Ory API clients to DBOS plugin
- Removed obsolete self-service E2E tests, updated token-exchange E2E tests
- Full test suite: 170 tests passing, lint clean, build clean

## What's Not Done Yet

- E2E tests need to be run against Docker infrastructure (requires `docker compose up`)
- Pre-existing `CombinedConfig` typecheck errors in `apps/server` (unrelated to this PR)
- Pre-existing `smol-toml` type errors in `tools` (unrelated)
- PR needs review and merge

## Current State

- **Branch**: `claude/fix-registration-admin-api` (12 commits)
- **Tests**: 170/170 pass (unit only; E2E needs Docker)
- **Lint**: 0 errors
- **Build**: All workspaces build
- **Typecheck**: `rest-api` clean; `server` and `tools` have pre-existing errors

## Decisions Made

1. **DBOS workflow over simple transaction**: Chose durable workflow for crash recovery and compensation (delete Kratos identity on failure)
2. **`dataSource.runTransaction()` directly in workflow**: Not wrapped in `DBOS.registerStep` — DBOS transactions are a special step type with automatic checkpointing
3. **Dependency injection via setter functions**: Follows the pattern from `keto-workflows.ts` — module-level variables set before DBOS launch
4. **Lazy workflow registration**: `initRegistrationWorkflow()` called after `configureDBOS()` but before `launchDBOS()`
5. **Kept webhook handler**: The `after-registration` webhook still exists for backward compatibility, though new registrations go through the DBOS workflow
6. **Token-exchange returns 403/500**: No more silent 200 with under-enriched tokens

## Workflow Steps (registration-workflow.ts)

1. `validateVoucherStep` — Check voucher exists and is valid (DBOS step, `retriesAllowed: false`)
2. `createKratosIdentityStep` — Create identity via Admin API (DBOS step with retry)
3. DB transaction — Redeem voucher + upsert agent (direct `dataSource.runTransaction()`)
4. `registerKetoPermissionsStep` — Register in Keto (DBOS step with retry)
5. `createOAuth2ClientStep` — Create Hydra client (DBOS step with retry)
6. Compensation: `deleteKratosIdentityStep` on failure after identity creation

## Continuity Notes

- The branch is ready for PR creation
- If E2E tests fail in CI, check that the Docker Compose setup includes the new DBOS plugin options (`identityApi`, `oauth2Api`)
- The `createAgent` E2E helper still uses Admin API + webhook (not `POST /auth/register`) — this is intentional for test isolation
