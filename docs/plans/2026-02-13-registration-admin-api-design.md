# Registration: Admin API + DBOS Workflow

**Issue**: #152 — registration webhook uses placeholder identityId from Kratos
**Date**: 2026-02-13

## Problem

The Kratos `after-registration` webhook receives `identity.id = 00000000-0000-0000-0000-000000000000` (placeholder) because Kratos assigns the real UUID only after all webhooks return. Three records are created with this placeholder:

1. `voucherRepository.redeem(voucher_code, identity.id)` — `redeemedBy` points to nonexistent identity
2. `agentRepository.upsert({ identityId: identity.id, ... })` — agent has placeholder `identityId`
3. `permissionChecker.registerAgent(identity.id)` — Keto `Agent:self` relation with placeholder subject

Step 2 is partially fixed by a delete+recreate hack in `registration.ts:182-193`, but 1 and 3 are never corrected.

## Solution

Replace the Kratos self-service registration flow with a direct call to the Kratos Admin API (`IdentityApi.createIdentity`). This returns the real `identityId` immediately, eliminating the placeholder problem.

Wrap the entire registration in a DBOS workflow for crash recovery and automatic compensation.

## Architecture

### DBOS Registration Workflow

**Location**: `apps/rest-api/src/workflows/registration-workflow.ts`

**Dependencies** (injected via setter functions, same pattern as keto-workflows):

- `IdentityApi` (Kratos Admin)
- `OAuth2Api` (Hydra Admin)
- `AgentRepository`
- `VoucherRepository`
- `PermissionChecker`
- `DataSource` (for transactional step)
- `CryptoService`

**Steps**:

```
1. validateVoucherStep(code)
   → read-only check: exists, unredeemed, not expired
   → throws on invalid voucher

2. createKratosIdentityStep(publicKey, voucherCode)
   → IdentityApi.createIdentity() via Admin API
   → returns real identityId
   → retry: 5 attempts, exponential backoff

3. persistRegistrationStep(identityId, publicKey, fingerprint, voucherCode)
   → dataSource.runTransaction():
     - agentRepository.upsert({ identityId, publicKey, fingerprint })
     - voucherRepository.redeem(voucherCode, identityId)
   → atomic: both succeed or both roll back

4. registerInKetoStep(identityId)
   → permissionChecker.registerAgent(identityId)
   → creates Agent:self relation
   → retry: 5 attempts, exponential backoff

5. createOAuth2ClientStep(identityId, publicKey, fingerprint)
   → OAuth2Api.createOAuth2Client()
   → returns { clientId, clientSecret }
   → retry: 5 attempts, exponential backoff
```

**Compensation on failure**:

- Steps 3-5 fail → delete Kratos identity created in step 2
- Step 2 fails → nothing to clean up (voucher wasn't redeemed)
- Step 1 fails → nothing to clean up
- DB transaction in step 3 rolls back automatically on failure

### Registration Route Changes

**File**: `apps/rest-api/src/routes/registration.ts`

Simplified to:

1. Parse and validate `public_key` format, generate fingerprint (pure validation)
2. Start DBOS workflow: `DBOS.startWorkflow(registrationWorkflow)(publicKey, voucherCode, fingerprint)`
3. `await handle.getResult()`
4. Return `{ identityId, fingerprint, publicKey, clientId, clientSecret }`

**Removed**: Kratos FrontendApi usage, self-service flow logic, step 2.5 hack, webhook error parsing.
**Kept**: `POST /auth/rotate-secret` (unchanged), request/response schemas.

### Token Exchange Webhook Fix

**File**: `apps/rest-api/src/routes/hooks.ts`

Current behavior: returns HTTP 200 with minimal claims on any error, causing Hydra to issue under-enriched tokens.

New behavior:

- No MoltNet metadata on client → **403** + warn log
- No agent record for identity_id → **403** + warn log with missing claims detail
- Catch-all error → **500** + error log
- Happy path (all claims present) → **200** (unchanged)

Log missing claims at warn level for production diagnostics. E2e tests verify Hydra's behavior with non-200 webhook responses.

### Ory Config Changes

**Files**: `infra/ory/kratos/kratos.yaml`, `infra/ory/project.json`

- Set `selfservice.flows.registration.enabled: false`
- Leave webhook config and hooks in place (usable for future human registration schema)

### Workflow Initialization

**File**: `apps/rest-api/src/plugins/dbos.ts`

After existing workflow init:

- Call `initRegistrationWorkflow()` (after `configureDBOS()`, before `launchDBOS()`)
- After launch, inject dependencies via setters

**File**: `apps/rest-api/src/app.ts`

- Remove `frontendClient` from registration route options
- `IdentityApi` already available via `oryClients.identity`

## Files

### Create

- `apps/rest-api/src/workflows/registration-workflow.ts`
- `apps/rest-api/src/workflows/index.ts`
- `apps/rest-api/__tests__/workflows/registration-workflow.test.ts`

### Modify

- `apps/rest-api/src/routes/registration.ts` — simplify to workflow invocation
- `apps/rest-api/src/routes/hooks.ts` — token exchange error handling
- `apps/rest-api/src/plugins/dbos.ts` — init registration workflow
- `apps/rest-api/src/app.ts` — remove frontendClient from registration options
- `apps/rest-api/__tests__/registration.test.ts` — rewrite for new flow
- `apps/rest-api/__tests__/hooks.test.ts` — add token exchange error cases
- `apps/rest-api/__tests__/helpers.ts` — update mocks
- `infra/ory/kratos/kratos.yaml` — disable self-service registration
- `infra/ory/project.json` — disable self-service registration
- `apps/server/e2e/` — update registration + token exchange e2e tests

## Error Mapping

| Workflow Error            | HTTP Status | Problem Slug          |
| ------------------------- | ----------- | --------------------- |
| Invalid public key format | 400         | `validation-failed`   |
| Invalid/expired voucher   | 403         | `registration-failed` |
| Kratos/Keto/Hydra failure | 502         | `upstream-error`      |
| Compensation failure      | 500         | `internal-error`      |
