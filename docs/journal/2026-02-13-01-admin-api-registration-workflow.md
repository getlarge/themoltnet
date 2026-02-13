---
date: '2026-02-13T07:29:49Z'
author: claude-sonnet-4-20250514
session: copilot-fix-registration-webhook-identityid
type: decision
importance: 0.8
tags: [registration, admin-api, dbos-workflow, kratos, placeholder-id]
supersedes: null
signature: pending
---

# Decision: Admin API + DBOS Workflow for Registration

## Context

Kratos self-service registration had a fundamental placeholder identity ID issue: webhooks receive `00000000-0000-0000-0000-000000000000` because Kratos assigns the real UUID only _after_ all webhooks complete. This caused:

1. Voucher `redeemedBy` permanently pointing to nonexistent identity
2. Agent records needing delete+recreate hack (step 2.5 in registration.ts)
3. Keto `Agent:self` relations using placeholder → permission checks failing

The original issue (#152) suggested either:

- **Option A**: Minimal change with placeholder handling
- **Option B**: Replace self-service with Admin API + DBOS workflow

## Decision

Implemented Option B: Complete replacement of self-service registration with Admin API + DBOS durable workflow.

### Architecture

**New DBOS Workflow** (`libs/database/src/workflows/registration-workflows.ts`):

- 7-step durable workflow with automatic retry and crash recovery
- Steps:
  1. Validate voucher (DB operation)
  2. Create Kratos identity via Admin API → **real ID returned immediately**
  3. Redeem voucher with real identity ID (DB operation)
  4. Create agent record with real identity ID (DB operation)
  5. Register agent in Keto with real identity ID
  6. Create OAuth2 client
  7. Cleanup on failure: delete identity

**Registration Route** (`apps/rest-api/src/routes/registration.ts`):

- POST /auth/register now uses DBOS workflow instead of self-service proxy
- Validates public key upfront
- Starts workflow and waits for result
- No more placeholder handling or delete+recreate hack

**Infrastructure Changes**:

- Disabled Kratos self-service registration (`registration.enabled: false`) in both Ory Network and local configs
- Skipped `registration.e2e.test.ts` (tested disabled self-service flow)
- `auth-register.e2e.test.ts` still covers Admin API registration

**Webhook Simplification** (`apps/rest-api/src/routes/hooks.ts`):

- After-registration webhook now only validates public key format
- No voucher validation or agent creation (deferred to workflow)
- Kept for backward compatibility with any direct Kratos usage

**Token-Exchange Fix**:

- Returns HTTP 500 (not 200) when enrichment fails
- Requires all MoltNet claims present (`identity_id`, `public_key`, `fingerprint`)

### Benefits

1. **No placeholder ID issue**: Admin API returns real identity ID immediately
2. **Atomic registration**: All steps succeed or all roll back with cleanup
3. **Durable execution**: Automatic crash recovery and retry
4. **Security**: Self-service registration disabled (all registration audited)
5. **Simpler code**: No placeholder handling, no delete+recreate hack

### Technical Notes

- Used `DBOS.registerStep()` for all operations (not `DBOS.registerTransaction`)
- Avoided `@ory/client` type imports in database package (used `any` type)
- Database operations called directly from workflow steps (correct DBOS pattern)

## Continuity Notes

**For future sessions**:

- All agent registration now goes through `/auth/register` endpoint
- Self-service registration is disabled (don't re-enable without addressing placeholder ID issue)
- If Kratos Admin API changes, update `registration-workflows.ts`
- OpenAPI spec and client need to be regenerated after this change

**Related files**:

- `libs/database/src/workflows/registration-workflows.ts` — workflow implementation
- `apps/rest-api/src/routes/registration.ts` — endpoint using workflow
- `apps/rest-api/src/routes/hooks.ts` — simplified webhook
- `infra/ory/project.json` — Ory Network config (registration.enabled: false)
- `infra/ory/kratos/kratos.yaml` — local Kratos config (registration.enabled: false)

**Tests updated**:

- `apps/rest-api/__tests__/hooks.test.ts` — webhook no longer does voucher/agent ops
- `apps/server/e2e/registration.e2e.test.ts` — skipped (tests disabled flow)
- `apps/server/e2e/auth-register.e2e.test.ts` — covers Admin API registration
