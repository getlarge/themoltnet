# @ory/client → @ory/client-fetch Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `@ory/client` (Axios) with `@ory/client-fetch` (native Fetch) across the entire monorepo.

**Architecture:** Mechanical SDK swap — change import sources, unwrap `{ data }` destructuring (fetch SDK returns `T` directly instead of `{ data: T }`), and migrate error handling from AxiosError to ResponseError (body needs async parsing). No new abstractions.

**Tech Stack:** `@ory/client-fetch` ^1.22.0, pnpm catalogs, TypeScript

---

### Task 1: Swap catalog entry and package.json dependencies

**Files:**

- Modify: `pnpm-workspace.yaml:31`
- Modify: `libs/auth/package.json:22`
- Modify: `libs/bootstrap/package.json:25`
- Modify: `apps/rest-api/package.json:38`
- Modify: `apps/server/package.json:32`

**Step 1: Update catalog entry**

In `pnpm-workspace.yaml`, replace line 31:

```yaml
# Before
'@ory/client': ^1.22.0
# After
'@ory/client-fetch': ^1.22.0
```

**Step 2: Update package.json files**

In each of these 4 files, replace `"@ory/client": "catalog:"` with `"@ory/client-fetch": "catalog:"`:

- `libs/auth/package.json` — in `dependencies`
- `libs/bootstrap/package.json` — in `dependencies`
- `apps/rest-api/package.json` — in `devDependencies`
- `apps/server/package.json` — in `dependencies`

**Step 3: Install dependencies**

Run: `pnpm install`
Expected: lockfile updates, `@ory/client` removed, `@ory/client-fetch` added, no axios in new resolution.

**Step 4: Commit**

```bash
git add pnpm-workspace.yaml libs/auth/package.json libs/bootstrap/package.json apps/rest-api/package.json apps/server/package.json pnpm-lock.yaml
git commit -m "chore: swap @ory/client for @ory/client-fetch in catalog (#67)"
```

---

### Task 2: Migrate libs/auth (imports + return value unwrapping)

**Files:**

- Modify: `libs/auth/src/ory-client.ts` — change import source
- Modify: `libs/auth/src/token-validator.ts` — change import + unwrap `{ data }`
- Modify: `libs/auth/src/permission-checker.ts` — change import + unwrap `{ data }`
- Modify: `libs/auth/src/index.ts` — change re-export source

**Step 1: Update `libs/auth/src/ory-client.ts`**

Change line 7-14 import source:

```ts
// Before
import {
  Configuration,
  FrontendApi,
  IdentityApi,
  OAuth2Api,
  PermissionApi,
  RelationshipApi,
} from '@ory/client';

// After
import {
  Configuration,
  FrontendApi,
  IdentityApi,
  OAuth2Api,
  PermissionApi,
  RelationshipApi,
} from '@ory/client-fetch';
```

**Step 2: Update `libs/auth/src/token-validator.ts`**

Change import source (line 11):

```ts
// Before
import type { OAuth2Api } from '@ory/client';
// After
import type { OAuth2Api } from '@ory/client-fetch';
```

Unwrap `{ data }` in `introspect()` (line 141):

```ts
// Before
const { data } = await oauth2Api.introspectOAuth2Token({ token });
if (!data.active) { ... }
const scopes = data.scope ? data.scope.split(' ').filter(Boolean) : [];
return { active: true, clientId: data.client_id ?? '', scopes, expiresAt: data.exp, ext: (data.ext as Record<string, unknown>) ?? {} };

// After
const data = await oauth2Api.introspectOAuth2Token({ token });
// rest unchanged — data.active, data.scope, data.client_id, data.exp, data.ext all same
```

Unwrap `{ data: client }` in `fetchClientMetadata()` (line 77):

```ts
// Before
const { data: client } = await oauth2Api.getOAuth2Client({ id: clientId });
// After
const client = await oauth2Api.getOAuth2Client({ id: clientId });
```

**Step 3: Update `libs/auth/src/permission-checker.ts`**

Change import source (line 8):

```ts
// Before
import type { PermissionApi, RelationshipApi } from '@ory/client';
// After
import type { PermissionApi, RelationshipApi } from '@ory/client-fetch';
```

Unwrap `{ data }` in `checkPermission()` (line 37):

```ts
// Before
const { data } = await permissionApi.checkPermission({ ... });
return data.allowed;
// After
const data = await permissionApi.checkPermission({ ... });
return data.allowed;
```

Remove `{ data }` wrapper from all `createRelationship` and `deleteRelationships` calls — these return void-like responses, but the existing code already ignores return values (just `await` them). However, they currently destructure nothing. Double-check: lines 95-102, 106-112, 116-123, 125-133, 136-141 — these are `await relationshipApi.createRelationship(...)` and `await relationshipApi.deleteRelationships(...)` with no destructuring. **No changes needed for these.**

**Step 4: Update `libs/auth/src/index.ts`**

Change re-export source (line 42):

```ts
// Before
export type { OAuth2Client } from '@ory/client';
// After
export type { OAuth2Client } from '@ory/client-fetch';
```

**Step 5: Run unit tests**

Run: `pnpm --filter @moltnet/auth test`
Expected: Tests will FAIL because mock return shapes still use `{ data: ... }` wrapper. This is expected — we fix mocks in Task 3.

**Step 6: Commit**

```bash
git add libs/auth/src/
git commit -m "refactor(auth): migrate to @ory/client-fetch SDK (#67)"
```

---

### Task 3: Update unit test mocks for libs/auth

**Files:**

- Modify: `libs/auth/__tests__/token-validator.test.ts`

**Step 1: Unwrap all mock return values**

Every `mockResolvedValue({ data: { ... } })` becomes `mockResolvedValue({ ... })`.

There are ~15 instances. Pattern:

```ts
// Before
mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
  data: {
    active: true,
    client_id: VALID_CLIENT_ID,
    scope: 'diary:read diary:write agent:profile',
    ...
  },
});

// After
mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
  active: true,
  client_id: VALID_CLIENT_ID,
  scope: 'diary:read diary:write agent:profile',
  ...
});
```

Same for `getOAuth2Client` mocks:

```ts
// Before
mockOAuth2Api.getOAuth2Client.mockResolvedValue({
  data: {
    client_id: VALID_CLIENT_ID,
    metadata: { ... },
  },
});

// After
mockOAuth2Api.getOAuth2Client.mockResolvedValue({
  client_id: VALID_CLIENT_ID,
  metadata: { ... },
});
```

**Step 2: Run unit tests**

Run: `pnpm --filter @moltnet/auth test`
Expected: All tests PASS.

**Step 3: Commit**

```bash
git add libs/auth/__tests__/
git commit -m "test(auth): update mocks for @ory/client-fetch return shapes (#67)"
```

---

### Task 4: Migrate libs/bootstrap

**Files:**

- Modify: `libs/bootstrap/src/bootstrap.ts`

**Step 1: Change import source (line 13)**

```ts
// Before
import { Configuration, IdentityApi, OAuth2Api } from '@ory/client';
// After
import { Configuration, IdentityApi, OAuth2Api } from '@ory/client-fetch';
```

**Step 2: Unwrap `{ data }` destructuring**

Three sites:

Line 169 — `listIdentitySchemas`:

```ts
// Before
const { data: schemas } = await opts.identityApi.listIdentitySchemas();
// After
const schemas = await opts.identityApi.listIdentitySchemas();
```

Line 178 — `createIdentity`:

```ts
// Before
const { data: identity } = await opts.identityApi.createIdentity({ ... });
// After
const identity = await opts.identityApi.createIdentity({ ... });
```

Line 211 — `createOAuth2Client`:

```ts
// Before
const { data: oauthClient } = await opts.hydraAdminOAuth2.createOAuth2Client({ ... });
// After
const oauthClient = await opts.hydraAdminOAuth2.createOAuth2Client({ ... });
```

**Step 3: Run typecheck**

Run: `pnpm --filter @moltnet/bootstrap typecheck`
Expected: PASS (no type errors).

**Step 4: Commit**

```bash
git add libs/bootstrap/src/
git commit -m "refactor(bootstrap): migrate to @ory/client-fetch SDK (#67)"
```

---

### Task 5: Migrate apps/rest-api routes

**Files:**

- Modify: `apps/rest-api/src/routes/registration.ts` — destructuring + error handling
- Modify: `apps/rest-api/src/routes/hooks.ts` — destructuring
- Modify: `apps/rest-api/src/routes/recovery.ts` — destructuring

Note: These files do NOT import `@ory/client` directly — they use `OryClients` from `@moltnet/auth`. Only the return value patterns and error handling need updating.

**Step 1: Update `registration.ts` — unwrap `{ data }` destructuring**

Line 123 — `createNativeRegistrationFlow`:

```ts
// Before
const result = await frontendClient.createNativeRegistrationFlow();
flow = result.data;
// After
flow = await frontendClient.createNativeRegistrationFlow();
```

Line 138-139 — `updateRegistrationFlow`:

```ts
// Before
const { data: registration } = await frontendClient.updateRegistrationFlow({ ... });
// After
const registration = await frontendClient.updateRegistrationFlow({ ... });
```

Line 197-198 — `createOAuth2Client`:

```ts
// Before
const { data: oauthClient } = await fastify.oauth2Client.createOAuth2Client({ ... });
// After
const oauthClient = await fastify.oauth2Client.createOAuth2Client({ ... });
```

Line 263 — `getOAuth2Client`:

```ts
// Before
const { data } = await fastify.oauth2Client.getOAuth2Client({ id: clientId });
existingClient = data;
// After
existingClient = await fastify.oauth2Client.getOAuth2Client({ id: clientId });
```

Line 275 — `setOAuth2Client` — already `await`ed without destructuring. **No change needed.**

**Step 2: Update `registration.ts` — error handling (lines 160-179)**

```ts
// Before
} catch (err: unknown) {
  const axiosError = err as {
    response?: { status: number; data: unknown };
  };
  const status = axiosError.response?.status;
  const data = axiosError.response?.data;

// After
} catch (err: unknown) {
  const response = (err as { response?: Response })?.response;
  const status = response?.status;
  const data = response ? await response.json().catch(() => undefined) : undefined;
```

Note: `.catch(() => undefined)` guards against non-JSON error bodies.

**Step 3: Update `hooks.ts` — unwrap `{ data }` (line 320)**

```ts
// Before
const { data: clientData } = await fastify.oauth2Client.getOAuth2Client({
  id: tokenRequest.client_id,
});
// After
const clientData = await fastify.oauth2Client.getOAuth2Client({
  id: tokenRequest.client_id,
});
```

**Step 4: Update `recovery.ts` — unwrap `{ data }` (line 161)**

```ts
// Before
const { data } = await identityClient.createRecoveryCodeForIdentity({ ... });
return { recoveryCode: data.recovery_code, recoveryFlowUrl: data.recovery_link };
// After
const data = await identityClient.createRecoveryCodeForIdentity({ ... });
return { recoveryCode: data.recovery_code, recoveryFlowUrl: data.recovery_link };
```

**Step 5: Run typecheck**

Run: `pnpm --filter @moltnet/rest-api typecheck`
Expected: PASS.

**Step 6: Commit**

```bash
git add apps/rest-api/src/routes/
git commit -m "refactor(rest-api): migrate to @ory/client-fetch return shapes (#67)"
```

---

### Task 6: Migrate apps/server e2e test infrastructure

**Files:**

- Modify: `apps/server/e2e/setup.ts` — imports + destructuring
- Modify: `apps/server/e2e/helpers.ts` — imports + destructuring

**Step 1: Update `setup.ts` imports (line 21-25)**

```ts
// Before
import {
  Configuration,
  FrontendApi,
  IdentityApi,
  OAuth2Api,
} from '@ory/client';

// After
import {
  Configuration,
  FrontendApi,
  IdentityApi,
  OAuth2Api,
} from '@ory/client-fetch';
```

No destructuring changes needed in `setup.ts` — it creates clients but doesn't call API methods with `{ data }`.

**Step 2: Update `helpers.ts` import (line 16)**

```ts
// Before
import type { IdentityApi, OAuth2Api } from '@ory/client';
// After
import type { IdentityApi, OAuth2Api } from '@ory/client-fetch';
```

**Step 3: Unwrap `{ data }` in `helpers.ts`**

Line 68 — `createIdentity`:

```ts
// Before
const { data: identity } = await opts.identityApi.createIdentity({ ... });
// After
const identity = await opts.identityApi.createIdentity({ ... });
```

Line 119 — `createOAuth2Client`:

```ts
// Before
const { data: oauthClient } = await opts.hydraAdminOAuth2.createOAuth2Client({ ... });
// After
const oauthClient = await opts.hydraAdminOAuth2.createOAuth2Client({ ... });
```

**Step 4: Commit**

```bash
git add apps/server/e2e/setup.ts apps/server/e2e/helpers.ts
git commit -m "refactor(e2e): migrate test infra to @ory/client-fetch (#67)"
```

---

### Task 7: Migrate e2e test assertions (destructuring + error handling)

**Files:**

- Modify: `apps/server/e2e/registration.e2e.test.ts`
- Modify: `apps/server/e2e/recovery.e2e.test.ts`

**Step 1: Update `registration.e2e.test.ts` import (line 19)**

```ts
// Before
import type { RegistrationFlow } from '@ory/client';
// After
import type { RegistrationFlow } from '@ory/client-fetch';
```

**Step 2: Unwrap `{ data }` in happy-path calls**

Every `const { data: xxx } = await harness.kratosPublicFrontend.someMethod(...)` and `const { data: xxx } = await harness.hydraAdminOAuth2.someMethod(...)` becomes direct assignment. There are ~8 sites in the file. Pattern:

```ts
// Before
const { data: flow } = await harness.kratosPublicFrontend.createNativeRegistrationFlow({ ... });
const { data: registration } = await harness.kratosPublicFrontend.updateRegistrationFlow({ ... });
const { data: oauthClient } = await harness.hydraAdminOAuth2.createOAuth2Client({ ... });

// After
const flow = await harness.kratosPublicFrontend.createNativeRegistrationFlow({ ... });
const registration = await harness.kratosPublicFrontend.updateRegistrationFlow({ ... });
const oauthClient = await harness.hydraAdminOAuth2.createOAuth2Client({ ... });
```

**Step 3: Migrate AxiosError catch blocks in `registration.e2e.test.ts`**

Three catch blocks (~lines 148, 194, 259) follow the same pattern:

```ts
// Before
} catch (error: unknown) {
  const axiosError = error as {
    response?: { status: number; data: unknown };
  };
  expect(axiosError.response).toBeDefined();
  expect([400, 422]).toContain(axiosError.response!.status);
  const messages = extractFlowMessages(axiosError.response!.data);

// After
} catch (error: unknown) {
  const response = (error as { response?: Response })?.response;
  expect(response).toBeDefined();
  expect([400, 422]).toContain(response!.status);
  const body = await response!.json();
  const messages = extractFlowMessages(body);
```

**Step 4: Migrate AxiosError catch block in `recovery.e2e.test.ts` (lines 177-188)**

```ts
// Before
} catch (err: unknown) {
  // Ory SDK wraps non-2xx responses as AxiosError
  const axiosErr = err as {
    response?: { status: number; data: Record<string, unknown> };
  };
  if (axiosErr.response) {
    kratosStatus = axiosErr.response.status;
    kratosResponseData = axiosErr.response.data;
  } else {
    throw err;
  }
}

// After
} catch (err: unknown) {
  // Ory SDK wraps non-2xx responses as ResponseError
  const response = (err as { response?: Response })?.response;
  if (response) {
    kratosStatus = response.status;
    kratosResponseData = await response.json();
  } else {
    throw err;
  }
}
```

Also update the `kratosResponse` happy path (line 175-176):

```ts
// Before
kratosStatus = kratosResponse.status;
kratosResponseData = kratosResponse.data as Record<string, unknown>;

// After — the fetch SDK returns the data directly, not a Response with .status
```

Wait — this needs careful attention. In the happy path, `updateRecoveryFlow` returns `RecoveryFlow` directly (not a Response). But we also need the HTTP status. Let me re-examine.

The `@ory/client` (axios) `updateRecoveryFlow` returned `{ data: RecoveryFlow, status: number }`. The `@ory/client-fetch` returns `RecoveryFlow` directly. For the happy path, we know it's 200 (since non-2xx throws). So:

```ts
// After — happy path
const recoveryResult = await harness.kratosPublicFrontend.updateRecoveryFlow({ ... });
kratosStatus = 200;
kratosResponseData = recoveryResult as unknown as Record<string, unknown>;
```

**Step 5: Commit**

```bash
git add apps/server/e2e/
git commit -m "refactor(e2e): migrate test assertions to @ory/client-fetch error patterns (#67)"
```

---

### Task 8: Validate everything

**Step 1: Run full typecheck**

Run: `pnpm run typecheck`
Expected: PASS across all workspaces.

**Step 2: Run all unit tests**

Run: `pnpm run test`
Expected: PASS across all workspaces.

**Step 3: Run lint**

Run: `pnpm run lint`
Expected: PASS (no unused imports, no lint errors).

**Step 4: Run build**

Run: `pnpm run build`
Expected: PASS.

**Step 5: Verify axios is gone from lockfile**

Run: `grep -c '"axios"' pnpm-lock.yaml` or `pnpm why axios`
Expected: axios no longer in the dependency tree (or only from unrelated packages).

**Step 6: Commit any lint/format fixes**

```bash
git add -A
git commit -m "chore: lint and format fixes after @ory/client-fetch migration (#67)"
```

(Skip if no changes.)
