# Registration Admin API + DBOS Workflow — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Kratos self-service registration flow (which receives a placeholder identityId) with a DBOS workflow that calls the Kratos Admin API directly, getting the real identityId immediately. Also fix the token-exchange webhook to reject under-enriched tokens.

**Architecture:** Registration moves from a Kratos self-service proxy + webhook into a single DBOS workflow with 5 steps: validate voucher → create Kratos identity (Admin API) → persist agent + redeem voucher (DB transaction) → register in Keto → create OAuth2 client. Compensation deletes the Kratos identity on failure. Token-exchange webhook returns non-200 when required claims are missing.

**Tech Stack:** DBOS workflows, Ory Kratos Admin API (IdentityApi), Ory Hydra Admin API (OAuth2Api), Drizzle ORM, Fastify, Vitest

**Design doc:** `docs/plans/2026-02-13-registration-admin-api-design.md`

---

### Task 1: Disable self-service registration in Ory configs

**Files:**

- Modify: `infra/ory/kratos/kratos.yaml:63` (registration.enabled)
- Modify: `infra/ory/project.json:48` (registration.enabled)

**Step 1: Disable in kratos.yaml**

Change `selfservice.flows.registration.enabled` from `true` to `false`:

```yaml
flows:
  registration:
    enabled: false
```

Leave everything else in the registration block (ui_url, after hooks) unchanged — it's dead code for now but available for future human registration.

**Step 2: Disable in project.json**

Change `services.identity.config.selfservice.flows.registration.enabled` from `true` to `false`:

```json
"registration": {
  "enabled": false,
```

Same rule — leave the rest of the registration config (hooks, ui_url) in place.

**Step 3: Commit**

```bash
git add infra/ory/kratos/kratos.yaml infra/ory/project.json
git commit -m "config: disable Kratos self-service registration (#152)"
```

---

### Task 2: Create the DBOS registration workflow

**Files:**

- Create: `apps/rest-api/src/workflows/registration-workflow.ts`
- Create: `apps/rest-api/src/workflows/index.ts`

**Step 1: Create `registration-workflow.ts`**

This file follows the same pattern as `libs/database/src/workflows/keto-workflows.ts`:

- Dependencies injected via setter functions
- Lazy registration via `initRegistrationWorkflow()`
- Steps registered with DBOS.registerStep
- Workflow registered with DBOS.registerWorkflow

Dependencies to inject:

- `IdentityApi` from `@ory/client`
- `OAuth2Api` from `@ory/client`
- `VoucherRepository` from `@moltnet/database`
- `AgentRepository` from `@moltnet/database`
- `PermissionChecker` from `@moltnet/auth`
- `DataSource` from `@moltnet/database`

Workflow steps:

1. `validateVoucherStep(code)` — calls `voucherRepository.findByCode(code)`, checks not null, not redeemed, not expired. Throws typed error on failure. No retry (validation only).

2. `createKratosIdentityStep(publicKey, voucherCode, schemaId)` — calls `identityApi.createIdentity()` with schema_id, traits (public_key, voucher_code), and password credentials. Returns `identityId`. Retry: 3 attempts with backoff (external API).

3. `persistRegistrationStep(identityId, publicKey, fingerprint, voucherCode)` — calls `dataSource.runTransaction()` wrapping `agentRepository.upsert()` and `voucherRepository.redeem()`. No retry (DB transaction — either commits or rolls back).

4. `registerInKetoStep(identityId)` — calls `permissionChecker.registerAgent(identityId)`. Retry: 5 attempts with backoff (matches existing keto step config).

5. `createOAuth2ClientStep(identityId, publicKey, fingerprint)` — calls `oauth2Api.createOAuth2Client()`. Returns `{ clientId, clientSecret }`. Retry: 3 attempts with backoff.

The workflow function orchestrates these steps sequentially. If any step after `createKratosIdentityStep` fails, run compensation: `identityApi.deleteIdentity({ id: identityId })`.

The workflow returns `{ identityId, fingerprint, publicKey, clientId, clientSecret }`.

Export typed error classes:

- `VoucherValidationError` (voucher not found, expired, or already redeemed)
- `RegistrationWorkflowError` (wraps upstream failures)

**Step 2: Create `index.ts`**

Re-exports `initRegistrationWorkflow`, `registrationWorkflow`, setter functions, and error types.

**Step 3: Run typecheck**

```bash
pnpm --filter @moltnet/rest-api run typecheck
```

Expected: PASS (no other code references these files yet)

**Step 4: Commit**

```bash
git add apps/rest-api/src/workflows/
git commit -m "feat: add DBOS registration workflow with compensation (#152)"
```

---

### Task 3: Write unit tests for the registration workflow

**Files:**

- Create: `apps/rest-api/__tests__/workflows/registration-workflow.test.ts`

**Step 1: Write the test file**

Mock DBOS using `vi.hoisted()` (same pattern as documented in `docs/DBOS.md` testing section). Mock all injected dependencies (IdentityApi, OAuth2Api, repositories, permissionChecker, dataSource).

Test cases:

1. **Happy path**: all steps succeed → returns `{ identityId, fingerprint, publicKey, clientId, clientSecret }`
2. **Invalid voucher**: `findByCode` returns null → throws `VoucherValidationError`
3. **Expired voucher**: `findByCode` returns expired voucher → throws `VoucherValidationError`
4. **Already redeemed voucher**: `findByCode` returns redeemed voucher → throws `VoucherValidationError`
5. **Kratos failure**: `createIdentity` rejects → throws `RegistrationWorkflowError`, no compensation needed
6. **DB transaction failure**: `runTransaction` rejects → compensation deletes Kratos identity
7. **Keto failure**: `registerAgent` rejects → compensation deletes Kratos identity
8. **Hydra failure**: `createOAuth2Client` rejects → compensation deletes Kratos identity
9. **Compensation failure**: identity deletion also fails → logs error, re-throws original error

**Step 2: Run tests**

```bash
pnpm --filter @moltnet/rest-api run test -- --run apps/rest-api/__tests__/workflows/registration-workflow.test.ts
```

Expected: Tests should pass (they test the workflow logic with mocked DBOS).

**Step 3: Commit**

```bash
git add apps/rest-api/__tests__/workflows/
git commit -m "test: add registration workflow unit tests (#152)"
```

---

### Task 4: Wire up the registration workflow in the DBOS plugin

**Files:**

- Modify: `apps/rest-api/src/plugins/dbos.ts`

**Step 1: Import and initialize the registration workflow**

Add imports from the new workflow module. After `initSigningWorkflows()` (line 71), call `initRegistrationWorkflow()`.

After `launchDBOS()` (line 93), inject dependencies using setters:

- `setRegistrationIdentityApi(fastify.oryClients.identity)` — but wait, oryClients isn't decorated on fastify yet at this point.

Actually, looking at `app.ts`, the DBOS plugin is registered inside `registerApiRoutes` indirectly via the server's bootstrap. The oryClients are passed as options. We need to pass the relevant clients to the DBOS plugin.

Update `DBOSPluginOptions` to include:

- `identityApi: IdentityApi`
- `oauth2Api: OAuth2Api`

Then in the plugin, after launch:

```typescript
setRegistrationDeps({
  identityApi: options.identityApi,
  oauth2Api: options.oauth2Api,
  agentRepository: fastify.agentRepository,
  voucherRepository: fastify.voucherRepository,
  permissionChecker: fastify.permissionChecker,
  dataSource: getDataSource(),
});
```

**Step 2: Update the server bootstrap to pass the new options**

Check `apps/server/src/app.ts` to see how the DBOS plugin receives options — update accordingly.

**Step 3: Run typecheck**

```bash
pnpm --filter @moltnet/rest-api run typecheck
```

**Step 4: Commit**

```bash
git add apps/rest-api/src/plugins/dbos.ts
git commit -m "feat: wire registration workflow into DBOS plugin (#152)"
```

---

### Task 5: Rewrite the registration route

**Files:**

- Modify: `apps/rest-api/src/routes/registration.ts`

**Step 1: Replace the registration handler**

Remove:

- `RegistrationRouteOptions` interface (no longer needs `frontendClient`)
- The Kratos self-service flow logic (create flow, submit flow, parse errors)
- Step 2.5 hack (find-by-fingerprint, delete, re-upsert)
- `WEBHOOK_ERROR_IDS`, `extractErrorMessages`, `pickProblemSlug`
- The inline OAuth2 client creation

Replace with:

- Import `DBOS` from `@dbos-inc/dbos-sdk`
- Import `registrationWorkflow`, error types from `../workflows/index.js`
- Import `cryptoService` from `@moltnet/crypto-service`
- The handler validates `public_key` format (using `cryptoService.parsePublicKey` + length check), generates fingerprint
- Starts DBOS workflow: `const handle = await DBOS.startWorkflow(registrationWorkflow)(publicKey, voucherCode, fingerprint)`
- Awaits result: `const result = await handle.getResult()`
- Returns the result
- Error handling: catch `VoucherValidationError` → `createProblem('registration-failed', ...)`, catch `RegistrationWorkflowError` → `createProblem('upstream-error', ...)`, catch anything else → `createProblem('internal-server-error', ...)`

The route no longer takes options (or takes minimal options). The `registrationRoutes` function signature changes:

```typescript
export async function registrationRoutes(fastify: FastifyInstance) {
```

**Step 2: Update `app.ts`**

Remove `frontendClient` from the `registrationRoutes` call:

```typescript
// Before:
await app.register(registrationRoutes, {
  frontendClient: options.oryClients.frontend,
});

// After:
await app.register(registrationRoutes);
```

Remove `FrontendApi` from the imports if no longer used elsewhere.

**Step 3: Run typecheck**

```bash
pnpm --filter @moltnet/rest-api run typecheck
```

**Step 4: Commit**

```bash
git add apps/rest-api/src/routes/registration.ts apps/rest-api/src/app.ts
git commit -m "refactor: replace self-service registration with DBOS workflow (#152)"
```

---

### Task 6: Update registration unit tests

**Files:**

- Create: `apps/rest-api/__tests__/registration.test.ts` (doesn't exist yet — the old self-service tests may have been removed previously)
- Modify: `apps/rest-api/__tests__/helpers.ts`

**Step 1: Update test helpers**

In `createMockServices`: no changes needed (agentRepository, voucherRepository, etc. are already mocked).

In `createTestApp`: the `mockOryClients.frontend` can remain an empty mock since registration no longer uses it. No changes strictly required, but clean up if desired.

**Step 2: Write registration route tests**

Mock the DBOS workflow module using `vi.mock`. The route now just validates input and starts a workflow, so tests focus on:

1. **Valid registration**: mock workflow to return success → 200 with credentials
2. **Invalid public key format** (not ed25519): → 400 validation-failed (caught before workflow)
3. **Invalid public key bytes** (wrong length): → 400 validation-failed
4. **Voucher validation error**: mock workflow to throw VoucherValidationError → 403 registration-failed
5. **Upstream error**: mock workflow to throw RegistrationWorkflowError → 502 upstream-error
6. **Missing body fields**: → 400 (Fastify schema validation)
7. **Rotate-secret** tests: unchanged (copy from existing if they exist)

**Step 3: Run tests**

```bash
pnpm --filter @moltnet/rest-api run test
```

Expected: All tests pass.

**Step 4: Commit**

```bash
git add apps/rest-api/__tests__/registration.test.ts apps/rest-api/__tests__/helpers.ts
git commit -m "test: rewrite registration route tests for workflow-based flow (#152)"
```

---

### Task 7: Fix token-exchange webhook error handling

**Files:**

- Modify: `apps/rest-api/src/routes/hooks.ts`

**Step 1: Update the token-exchange handler**

Change the three error paths (lines 326-384 in hooks.ts):

Path 1 — no MoltNet metadata (line 326-337):

```typescript
if (!isMoltNetMetadata(clientData.metadata)) {
  fastify.log.warn(
    { client_id: tokenRequest.client_id },
    'Token exchange rejected: OAuth2 client has no MoltNet metadata',
  );
  return await reply.status(403).send({
    error: 'invalid_client_metadata',
    error_description: 'OAuth2 client is not a MoltNet agent',
  });
}
```

Path 2 — no agent record (line 343-358):

```typescript
if (!agent) {
  fastify.log.warn(
    {
      identity_id: identityId,
      client_id: tokenRequest.client_id,
      missing_claims: ['public_key', 'fingerprint'],
    },
    'Token exchange rejected: no agent record for identity_id',
  );
  return await reply.status(403).send({
    error: 'agent_not_found',
    error_description: 'No agent record found for identity',
  });
}
```

Path 3 — catch-all error (line 371-384):

```typescript
catch (error) {
  fastify.log.error(
    { error, client_id: tokenRequest.client_id },
    'Token exchange failed: error enriching token',
  );
  return reply.status(500).send({
    error: 'enrichment_failed',
    error_description: 'Failed to enrich token with agent claims',
  });
}
```

**Step 2: Run typecheck**

```bash
pnpm --filter @moltnet/rest-api run typecheck
```

**Step 3: Commit**

```bash
git add apps/rest-api/src/routes/hooks.ts
git commit -m "fix: token-exchange webhook returns non-200 on missing claims (#152)"
```

---

### Task 8: Update hooks unit tests for token-exchange changes

**Files:**

- Modify: `apps/rest-api/__tests__/hooks.test.ts`

**Step 1: Update existing token-exchange tests**

The test "falls back to minimal claims when agent not found" (line 200-222) currently expects 200. Change to expect 403:

```typescript
it('rejects token exchange when agent not found', async () => {
  mocks.agentRepository.findByIdentityId.mockResolvedValue(null);

  const response = await app.inject({
    method: 'POST',
    url: '/hooks/hydra/token-exchange',
    headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
    payload: {
      session: {},
      request: {
        client_id: 'hydra-client-uuid',
        grant_types: ['client_credentials'],
      },
    },
  });

  expect(response.statusCode).toBe(403);
  const body = response.json();
  expect(body.error).toBe('agent_not_found');
});
```

**Step 2: Add new test cases**

- **No MoltNet metadata**: mock `getOAuth2Client` to return client without `identity_id` in metadata → 403 with `invalid_client_metadata`
- **Hydra client fetch error**: mock `getOAuth2Client` to reject → 500 with `enrichment_failed`

**Step 3: Run tests**

```bash
pnpm --filter @moltnet/rest-api run test -- --run apps/rest-api/__tests__/hooks.test.ts
```

Expected: All tests pass.

**Step 4: Commit**

```bash
git add apps/rest-api/__tests__/hooks.test.ts
git commit -m "test: update token-exchange tests for non-200 error responses (#152)"
```

---

### Task 9: Update the server bootstrap (apps/server)

**Files:**

- Modify: `apps/server/src/app.ts`

**Step 1: Pass IdentityApi and OAuth2Api to the DBOS plugin**

Check how the server app builds and passes options to the DBOS plugin. Add `identityApi` and `oauth2Api` to the DBOS plugin options.

Also verify that the registration route no longer receives `frontendClient`.

**Step 2: Run typecheck on server**

```bash
pnpm --filter @moltnet/server run typecheck
```

**Step 3: Commit**

```bash
git add apps/server/src/app.ts
git commit -m "feat: pass Ory API clients to DBOS plugin for registration workflow (#152)"
```

---

### Task 10: Update E2E tests

**Files:**

- Modify: `apps/server/e2e/auth-register.e2e.test.ts`
- Modify: `apps/server/e2e/registration.e2e.test.ts`
- Modify: `apps/server/e2e/hooks.e2e.test.ts`
- Modify: `apps/server/e2e/helpers.ts`

**Step 1: Update `auth-register.e2e.test.ts`**

These tests hit `POST /auth/register` directly. The response shape is the same (`identityId`, `fingerprint`, `publicKey`, `clientId`, `clientSecret`), so most tests should pass without changes.

Key difference: registration no longer goes through Kratos self-service, so error messages may differ slightly. Check that:

- Invalid voucher still returns 403
- Invalid public key still returns 400
- Already-used voucher still returns 403
- Happy path still returns 200 with credentials

Update assertions if error message text changes (e.g., `detail` field content).

**Step 2: Update `registration.e2e.test.ts`**

This file tests the **self-service** Kratos registration flow directly. Since self-service registration is now disabled, these tests need significant rework:

- Remove tests that create Kratos registration flows directly
- Replace with tests that go through `POST /auth/register` (the REST API endpoint)
- Or skip/delete this file if `auth-register.e2e.test.ts` already covers the same scenarios

**Step 3: Update `hooks.e2e.test.ts`**

Token-exchange tests:

- "returns minimal claims for unknown client" currently expects 200 → update to expect the new non-200 status
- Add test: verify Hydra behavior when token hook returns non-200 (does it reject the client_credentials grant?)

After-registration webhook tests stay as-is (webhook handler still exists, just not triggered by Kratos self-service anymore).

**Step 4: Update `helpers.ts`**

The `createAgent` helper currently:

1. Creates Kratos identity via Admin API
2. Calls the after-registration webhook manually
3. Creates OAuth2 client via Admin API

Option A: Keep this pattern (it still works since the webhook handler is kept).
Option B: Use `POST /auth/register` instead (simpler, tests the actual production path).

Recommend Option B for new tests, keep Option A for tests that specifically test the webhook handler.

**Step 5: Run E2E tests**

```bash
pnpm --filter @moltnet/server run test:e2e
```

Note: E2E tests require Docker infrastructure. If not available, skip this step and note it as "to be verified in CI".

**Step 6: Commit**

```bash
git add apps/server/e2e/
git commit -m "test: update E2E tests for Admin API registration flow (#152)"
```

---

### Task 11: Run full validation suite

**Step 1: Lint**

```bash
pnpm run lint
```

**Step 2: Typecheck**

```bash
pnpm run typecheck
```

**Step 3: Unit tests**

```bash
pnpm run test
```

**Step 4: Build**

```bash
pnpm run build
```

**Step 5: Fix any failures, commit**

```bash
git add -A
git commit -m "fix: address validation issues (#152)"
```

---

### Task 12: Update OpenAPI spec

**Step 1: Regenerate**

```bash
pnpm run generate:openapi
```

The registration endpoint schema may have changed (no longer references FrontendApi-related types). Regenerate to capture the changes.

**Step 2: Commit if changed**

```bash
git add docs/openapi*
git commit -m "docs: regenerate OpenAPI spec (#152)"
```
