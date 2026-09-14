# Recover-or-mint OAuth2 client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /recovery/credentials` mints the agent's deterministic OAuth2
client when none exists, and `moltnet agents credentials recover --yes` works
for an identity that only has an agent key.

**Architecture:** The Hydra client body builder moves out of the registration
workflow into a shared util so registration and recovery mint identical clients.
The recovery route gains a mint branch after the deterministic lookup and the
legacy lookup both find nothing. The Go CLI's recovery command defaults the
secret destination when the config has no OAuth2 block yet.

**Tech Stack:** Fastify + TypeBox (rest-api), Ory Hydra admin API via
`@ory/client-fetch`, Vitest (`apps/rest-api/__tests__`), rest-api e2e against
the Docker stack, Go 1.x with `httptest` (`apps/moltnet-cli`).

**Spec:**
`docs/superpowers/specs/2026-09-14-register-recover-onboarding-design.md`,
Component A.

## Global Constraints

- Work in this worktree on branch `feat/recover-or-mint-oauth2-client`. Never
  touch the primary checkout.
- Every commit needs a LeGreffier diary entry first:
  `moltnet entry commit --diary-id 6e4d9948-8ec5-4f59-b82a-3acbc4bbc396 --risk <level> --scope "<areas>" --operator edouard --tool claude --rationale "<3-6 sentences>"`,
  then reference the returned `entryId` as `MoltNet-Diary: <id>` in the commit
  body. Add `Task-Group: recover-or-mint-oauth2-client` to every commit,
  `Task-Family: feature` on the first, `Task-Completes: true` on the last.
- End every commit body with
  `Claude-Session: https://claude.ai/code/session_015FWKhcNAMs5RKTEkA3bLsS`.
- Conventional commit types, no `!` breaking marker.
- Prefer Nx: `pnpm exec nx run @moltnet/rest-api:test`,
  `pnpm exec nx run @moltnet/rest-api:lint`,
  `pnpm exec nx run @moltnet/rest-api:typecheck`. Go tests:
  `cd apps/moltnet-cli && go test ./...`.
- The e2e suite needs the Docker stack: `pnpm run e2e:up` once, then
  `NX_LOAD_DOT_ENV_FILES=false pnpm exec nx run @moltnet/rest-api-e2e:e2e`.
- No dynamic `import()` in tests. Static imports only.
- This repository is public. Commit messages describe the mechanism, never a
  weakness.

---

## File structure

- Create `apps/rest-api/src/utils/agent-oauth2-client.ts`: pure function
  `buildAgentOAuth2Client` returning the Hydra `OAuth2Client` body for an agent.
  No I/O.
- Create `apps/rest-api/__tests__/agent-oauth2-client.test.ts`: shape test for
  the builder.
- Modify `apps/rest-api/src/workflows/registration-workflow.ts:226-258`: call
  the builder instead of building the body inline.
- Modify `apps/rest-api/src/routes/recovery.ts:272-553`: add the mint branch and
  the create-or-set write.
- Modify `apps/rest-api/__tests__/recovery.test.ts:393-812`: add mint tests,
  move the "no match" row out of the "does not mutate" table.
- Modify `apps/rest-api-e2e/src/recovery.e2e.test.ts`: add the agent-key
  registration case and the repeat-recovery case.
- Modify `apps/moltnet-cli/agents_credentials.go:241-256`: default destination
  for a config without OAuth2.
- Modify `apps/moltnet-cli/agents_credentials_test.go`: extract the recovery
  test server into a helper and add the agent-key-only case.

---

### Task 1: Shared Hydra client builder

**Files:**

- Create: `apps/rest-api/src/utils/agent-oauth2-client.ts`
- Create: `apps/rest-api/__tests__/agent-oauth2-client.test.ts`
- Modify: `apps/rest-api/src/workflows/registration-workflow.ts:226-258`

**Interfaces:**

- Produces:

  ```ts
  export interface AgentOAuth2ClientInput {
    agentId: string;
    identityId: string | null;
    publicKey: string;
    fingerprint: string;
    clientSecret: string;
  }
  export function buildAgentOAuth2Client(
    input: AgentOAuth2ClientInput,
  ): OAuth2Client; // from '@ory/client-fetch'
  ```

  `client_id` is `agentOAuth2ClientId(input.agentId)`. `metadata.identity_id` is
  omitted when `identityId` is null.

- [ ] **Step 1: Write the failing test**

Create `apps/rest-api/__tests__/agent-oauth2-client.test.ts`:

```ts
import { AGENT_OAUTH_SCOPES } from '@moltnet/auth';
import { describe, expect, it } from 'vitest';

import { agentOAuth2ClientId } from '../src/utils/agent-oauth-client-id.js';
import { buildAgentOAuth2Client } from '../src/utils/agent-oauth2-client.js';

describe('buildAgentOAuth2Client', () => {
  const input = {
    agentId: '11111111-1111-4111-8111-111111111111',
    identityId: '22222222-2222-4222-8222-222222222222',
    publicKey: 'ed25519:AAAA+/bbbb==',
    fingerprint: 'ABCD-EF01-2345-6789',
    clientSecret: 'secret-value',
  };

  it('builds the client_credentials client keyed by the durable agent id', () => {
    const client = buildAgentOAuth2Client(input);

    expect(client).toEqual({
      client_id: agentOAuth2ClientId(input.agentId),
      client_secret: 'secret-value',
      client_name: `Agent: ${input.fingerprint}`,
      grant_types: ['client_credentials'],
      response_types: [],
      token_endpoint_auth_method: 'client_secret_post',
      scope: AGENT_OAUTH_SCOPES.join(' '),
      metadata: {
        type: 'moltnet_agent',
        agent_id: input.agentId,
        identity_id: input.identityId,
        public_key: input.publicKey,
        fingerprint: input.fingerprint,
      },
    });
  });

  it('omits identity_id when the agent has no bound Ory identity', () => {
    const client = buildAgentOAuth2Client({ ...input, identityId: null });

    expect(client.metadata).not.toHaveProperty('identity_id');
    expect(client.metadata).toMatchObject({ agent_id: input.agentId });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
`pnpm exec nx run @moltnet/rest-api:test -- __tests__/agent-oauth2-client.test.ts`
Expected: FAIL, cannot resolve `../src/utils/agent-oauth2-client.js`.

- [ ] **Step 3: Write the builder**

Create `apps/rest-api/src/utils/agent-oauth2-client.ts`:

```ts
import { AGENT_OAUTH_SCOPES } from '@moltnet/auth';
import type { OAuth2Client } from '@ory/client-fetch';

import { agentOAuth2ClientId } from './agent-oauth-client-id.js';

export interface AgentOAuth2ClientInput {
  /** Durable `agents.id`; the token webhook looks clients up by it. */
  agentId: string;
  /** Kratos binding, retained for compatibility; may be absent after a relink. */
  identityId: string | null;
  publicKey: string;
  fingerprint: string;
  clientSecret: string;
}

/**
 * The one Hydra client shape MoltNet issues to an agent. Registration creates
 * it; credential recovery re-creates it when it is missing. Keeping the body
 * in one place means both paths mint a client the token webhook recognises.
 */
export function buildAgentOAuth2Client(
  input: AgentOAuth2ClientInput,
): OAuth2Client {
  return {
    client_id: agentOAuth2ClientId(input.agentId),
    client_secret: input.clientSecret,
    client_name: `Agent: ${input.fingerprint}`,
    grant_types: ['client_credentials'],
    response_types: [],
    token_endpoint_auth_method: 'client_secret_post',
    scope: AGENT_OAUTH_SCOPES.join(' '),
    metadata: {
      type: 'moltnet_agent',
      agent_id: input.agentId,
      ...(input.identityId ? { identity_id: input.identityId } : {}),
      public_key: input.publicKey,
      fingerprint: input.fingerprint,
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
`pnpm exec nx run @moltnet/rest-api:test -- __tests__/agent-oauth2-client.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Use the builder in the registration workflow**

In `apps/rest-api/src/workflows/registration-workflow.ts`, add the import next
to the existing `agentOAuth2ClientId` import:

```ts
import { agentOAuth2ClientId } from '../utils/agent-oauth-client-id.js';
import { buildAgentOAuth2Client } from '../utils/agent-oauth2-client.js';
```

Replace lines 232-251 (from `const clientId = agentOAuth2ClientId(...)` through
the closing `};` of `oAuth2Client`) with:

```ts
const clientId = agentOAuth2ClientId(registration.agentId);
const clientSecret = crypto.randomUUID();
const oAuth2Client = buildAgentOAuth2Client({
  agentId: registration.agentId,
  identityId: registration.identityId,
  publicKey: registration.publicKey,
  fingerprint: registration.fingerprint,
  clientSecret,
});
```

Keep the `try { createOAuth2Client } catch { setOAuth2Client }` block unchanged.
If `AGENT_OAUTH_SCOPES` is no longer referenced elsewhere in the file, remove it
from the `@moltnet/auth` import; the agent-key branch still uses it, so check
before removing.

- [ ] **Step 6: Run the registration tests, lint, typecheck**

Run:
`pnpm exec nx run @moltnet/rest-api:test -- __tests__/registration.test.ts __tests__/agent-oauth2-client.test.ts`
Expected: PASS. Run:
`pnpm exec nx run-many -t lint typecheck --projects=@moltnet/rest-api` Expected:
success.

- [ ] **Step 7: Diary entry and commit**

```bash
git add apps/rest-api/src/utils/agent-oauth2-client.ts apps/rest-api/__tests__/agent-oauth2-client.test.ts apps/rest-api/src/workflows/registration-workflow.ts
moltnet entry commit --diary-id 6e4d9948-8ec5-4f59-b82a-3acbc4bbc396 --risk low --scope "rest-api,auth" --operator edouard --tool claude --rationale "Extracts the Hydra client body that registration issues to an agent into a pure builder so credential recovery can mint the identical client in the next commit. Behavior of registration is unchanged; the builder omits identity_id when an agent has no bound Ory identity, which recovery needs after a relink. Covered by a shape test."
git commit -m "refactor(rest-api): share the agent OAuth2 client builder" -m "MoltNet-Diary: <entryId>
Task-Group: recover-or-mint-oauth2-client
Task-Family: feature

Claude-Session: https://claude.ai/code/session_015FWKhcNAMs5RKTEkA3bLsS"
```

---

### Task 2: Recovery mints the deterministic client when none exists

**Files:**

- Modify: `apps/rest-api/src/routes/recovery.ts:272-553`
- Modify: `apps/rest-api/__tests__/recovery.test.ts:393-812`

**Interfaces:**

- Consumes: `buildAgentOAuth2Client` from Task 1.
- Produces: unchanged HTTP contract. `POST /recovery/credentials` returns
  `200 { clientId, sealedClientSecret }` for an agent with no OAuth2 client;
  `clientId` equals `agentOAuth2ClientId(agent.id)`.

- [ ] **Step 1: Write the failing tests**

In `apps/rest-api/__tests__/recovery.test.ts`, inside
`describe('POST /recovery/credentials')`, first remove the
`['no match', [page([])], 404],` row from the `it.each` table at lines 719-733
(that behavior is replaced). Then add these two tests after the
`'delivers the sealed replacement when post-commit eviction fails'` test:

```ts
it('mints the deterministic client when the agent has none', async () => {
  const keyPair = await cryptoService.generateKeyPair();
  const agent = createMockAgent({
    publicKey: keyPair.publicKey,
    fingerprint: keyPair.fingerprint,
  });
  const challenge = generateRecoveryChallenge(agent.publicKey, 'credentials');
  const hmac = signChallenge(challenge, TEST_RECOVERY_SECRET);
  const signature = await cryptoService.sign(challenge, keyPair.privateKey);
  mocks.agentRepository.findByPublicKey.mockResolvedValue(agent);
  mocks.cryptoService.verify.mockImplementation((...args) =>
    cryptoService.verify(...args),
  );

  const createOAuth2Client = vi.fn().mockResolvedValue(undefined);
  const setOAuth2Client = vi.fn();
  const evictOAuthClient = vi.fn();
  const testApp = await createCredentialsApp(
    {
      getOAuth2Client: vi.fn().mockRejectedValue(notFound()),
      listOAuth2ClientsRaw: vi.fn().mockResolvedValue(page([])),
      createOAuth2Client,
      setOAuth2Client,
    },
    evictOAuthClient,
  );

  try {
    const response = await testApp.inject({
      method: 'POST',
      url: '/recovery/credentials',
      payload: { challenge, hmac, signature, publicKey: agent.publicKey },
    });

    expect(response.statusCode).toBe(200);
    const recovered = response.json();
    const clientSecret = openSealedEnvelope(
      recovered.sealedClientSecret,
      keyPair.privateKey,
    );
    expect(recovered.clientId).toBe(agentOAuth2ClientId(agent.id));
    expect(createOAuth2Client).toHaveBeenCalledWith({
      oAuth2Client: expect.objectContaining({
        client_id: agentOAuth2ClientId(agent.id),
        client_secret: clientSecret,
        client_name: `Agent: ${agent.fingerprint}`,
        grant_types: ['client_credentials'],
        token_endpoint_auth_method: 'client_secret_post',
        metadata: expect.objectContaining({
          type: 'moltnet_agent',
          agent_id: agent.id,
          public_key: agent.publicKey,
          fingerprint: agent.fingerprint,
        }),
      }),
    });
    expect(setOAuth2Client).not.toHaveBeenCalled();
    expect(evictOAuthClient).toHaveBeenCalledWith(recovered.clientId);
  } finally {
    await testApp.close();
  }
});

it('falls back to replacing the client when the mint conflicts', async () => {
  const agent = createMockAgent({ publicKey: CREDENTIALS_PUBLIC_KEY });
  mocks.agentRepository.findByPublicKey.mockResolvedValue(agent);
  mocks.cryptoService.verify.mockResolvedValue(true);

  const createOAuth2Client = vi
    .fn()
    .mockRejectedValue(
      Object.assign(new Error('conflict'), { response: { status: 409 } }),
    );
  const setOAuth2Client = vi.fn().mockResolvedValue(undefined);
  const testApp = await createCredentialsApp({
    getOAuth2Client: vi.fn().mockRejectedValue(notFound()),
    listOAuth2ClientsRaw: vi.fn().mockResolvedValue(page([])),
    createOAuth2Client,
    setOAuth2Client,
  });

  try {
    const response = await testApp.inject({
      method: 'POST',
      url: '/recovery/credentials',
      payload: createCredentialsPayload(),
    });

    expect(response.statusCode).toBe(200);
    expect(createOAuth2Client).toHaveBeenCalledTimes(1);
    expect(setOAuth2Client).toHaveBeenCalledWith({
      id: agentOAuth2ClientId(agent.id),
      oAuth2Client: expect.objectContaining({
        client_id: agentOAuth2ClientId(agent.id),
      }),
    });
  } finally {
    await testApp.close();
  }
});

it('returns 502 without a client when the mint fails', async () => {
  const agent = createMockAgent({ publicKey: CREDENTIALS_PUBLIC_KEY });
  mocks.agentRepository.findByPublicKey.mockResolvedValue(agent);
  mocks.cryptoService.verify.mockResolvedValue(true);

  const setOAuth2Client = vi.fn();
  const testApp = await createCredentialsApp({
    getOAuth2Client: vi.fn().mockRejectedValue(notFound()),
    listOAuth2ClientsRaw: vi.fn().mockResolvedValue(page([])),
    createOAuth2Client: vi
      .fn()
      .mockRejectedValue(new Error('Hydra unavailable')),
    setOAuth2Client,
  });

  try {
    const response = await testApp.inject({
      method: 'POST',
      url: '/recovery/credentials',
      payload: createCredentialsPayload(),
    });

    expect(response.statusCode).toBe(502);
    expect(setOAuth2Client).not.toHaveBeenCalled();
  } finally {
    await testApp.close();
  }
});
```

Add the import at the top of the test file next to the other `../src` imports:

```ts
import { agentOAuth2ClientId } from '../src/utils/agent-oauth-client-id.js';
```

Check what `createMockAgent` returns for the agent id field (`id`) in the test
helpers at the top of the file; the assertions above use `agent.id`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec nx run @moltnet/rest-api:test -- __tests__/recovery.test.ts`
Expected: the three new tests FAIL (404 instead of 200 for the first two, and
404 instead of 502 for the third). Everything else passes.

- [ ] **Step 3: Implement the mint branch**

In `apps/rest-api/src/routes/recovery.ts`:

Add the import next to `agentOAuth2ClientId`:

```ts
import { agentOAuth2ClientId } from '../utils/agent-oauth-client-id.js';
import { buildAgentOAuth2Client } from '../utils/agent-oauth2-client.js';
```

Change the declaration at line 296 from `let existingClient;` to:

```ts
let existingClient: OAuth2Client | undefined;
```

and add `import type { OAuth2Client } from '@ory/client-fetch';` to the imports.

Replace the `if (ranked.length === 0) { throw createProblem('not-found', ...) }`
block (lines 416-421) with nothing: delete it. Keep the `ranked.length > 1`
conflict branch. Change the assignment after it from
`existingClient = ranked[0];` to:

```ts
existingClient = ranked.length === 1 ? ranked[0] : undefined;
```

Replace lines 440-456 (the
`const clientId = existingClient.client_id; if (!clientId) {...}` block) with:

```ts
const minted = existingClient === undefined;
const clientId = minted ? deterministicClientId : existingClient.client_id;
if (!clientId) {
  fastify.log.error(
    {
      fingerprint: agent.fingerprint,
      identityId: agent.identityId,
      requestId: request.id,
      ip: request.ip,
      rotated: false,
    },
    'OAuth2 credential recovery client has no ID',
  );
  throw createProblem('upstream-error', 'OAuth2 client data is incomplete');
}
```

In the "client resolved" log at lines 458-468, replace the `resolution:` line
with:

```ts
          resolution: minted
            ? 'minted'
            : clientId === deterministicClientId
              ? 'deterministic'
              : 'legacy',
```

Replace the mutation `try` block at lines 497-522 with:

```ts
try {
  if (minted) {
    const oAuth2Client = buildAgentOAuth2Client({
      agentId: agent.id,
      identityId: agent.identityId,
      publicKey: agent.publicKey,
      fingerprint: agent.fingerprint,
      clientSecret,
    });
    try {
      await fastify.oauth2Client.createOAuth2Client({ oAuth2Client });
    } catch (err) {
      // A concurrent recovery or a late registration step can have
      // created the deterministic client between lookup and mint.
      if (upstreamStatus(err) !== 409) throw err;
      await fastify.oauth2Client.setOAuth2Client({
        id: clientId,
        oAuth2Client,
      });
    }
  } else {
    await fastify.oauth2Client.setOAuth2Client({
      id: clientId,
      oAuth2Client: {
        ...existingClient,
        client_secret: clientSecret,
      },
    });
  }
} catch (err) {
  fastify.log.error(
    {
      err,
      fingerprint: agent.fingerprint,
      identityId: agent.identityId,
      clientId,
      minted,
      requestId: request.id,
      ip: request.ip,
      rotated: false,
    },
    minted
      ? 'OAuth2 credential recovery mint failed'
      : 'OAuth2 credential recovery mutation failed',
  );
  throw createProblem(
    'upstream-error',
    minted
      ? 'Failed to create OAuth2 credentials'
      : 'Failed to replace OAuth2 credentials',
  );
}
```

Add `minted,` to the final `fastify.log.warn` object at lines 541-551 so the
Axiom line distinguishes the two outcomes.

`agent.id` and `agent.identityId` come from the `Agent` type in
`@moltnet/database`; `identityId` is nullable there, which the builder accepts.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec nx run @moltnet/rest-api:test -- __tests__/recovery.test.ts`
Expected: PASS, including the existing legacy-lookup, ambiguity, and
non-mutation cases.

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm exec nx run-many -t lint typecheck --projects=@moltnet/rest-api`
Expected: success. If `OAuth2Client` from `@ory/client-fetch` makes `ranked[0]`
incompatible, type the `matches` array as `OAuth2Client[]` where it is declared.

- [ ] **Step 6: Diary entry and commit**

```bash
git add apps/rest-api/src/routes/recovery.ts apps/rest-api/__tests__/recovery.test.ts
moltnet entry commit --diary-id 6e4d9948-8ec5-4f59-b82a-3acbc4bbc396 --risk high --scope "rest-api,auth" --operator edouard --tool claude --rationale "Credential recovery now mints the deterministic OAuth2 client when neither the deterministic id nor a legacy client matches, instead of returning not-found. An agent registered with an agent key can therefore obtain OAuth2 credentials by proving possession of its Ed25519 key, the same authority self-registration accepted. The client body comes from the shared builder so the token webhook recognises it. Conflicts on create fall back to replace, failures return 502 without partial state, and the log records minted so rotation and mint are separable in Axiom. Unit tests cover mint, conflict fallback, and mint failure."
git commit -m "feat(rest-api): mint the OAuth2 client on credential recovery" -m "MoltNet-Diary: <entryId>
Task-Group: recover-or-mint-oauth2-client

Claude-Session: https://claude.ai/code/session_015FWKhcNAMs5RKTEkA3bLsS"
```

---

### Task 3: End-to-end proof against the Docker stack

**Files:**

- Modify: `apps/rest-api-e2e/src/recovery.e2e.test.ts`

**Interfaces:**

- Consumes: `POST /auth/register` with `credentialType: 'agent_key'` (existing),
  `POST /recovery/challenge`, `POST /recovery/credentials` (Task 2 behavior).

- [ ] **Step 1: Write the failing e2e tests**

At the top of `apps/rest-api-e2e/src/recovery.e2e.test.ts`, extend the imports:

```ts
import { randomBytes } from 'node:crypto';

import { buildSelfRegistrationMessage } from '@moltnet/models';
```

Add this helper after `requestOAuthToken`:

```ts
/**
 * Register an agent that only holds an agent key: the shape the daemon's
 * managed-agent path produces. No OAuth2 client exists for it yet.
 */
async function registerAgentKeyAgent(baseUrl: string) {
  const keyPair = await cryptoService.generateKeyPair();
  const idempotencyKey = randomBytes(32).toString('base64url');
  const proof = await cryptoService.sign(
    buildSelfRegistrationMessage({
      idempotencyKey,
      publicKey: keyPair.publicKey,
      credentialType: 'agent_key',
    }),
    keyPair.privateKey,
  );
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      publicKey: keyPair.publicKey,
      proof,
      credentialType: 'agent_key',
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Registration failed: ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as {
    agentId: string;
    credential: { type: 'agent_key'; secret: string };
  };
  expect(body.credential.type).toBe('agent_key');
  return { keyPair, agentId: body.agentId };
}

async function recoverCredentials(
  apiClient: Client,
  keyPair: { publicKey: string; privateKey: string },
) {
  const { data: challengeData, error: challengeError } =
    await requestRecoveryChallenge({
      client: apiClient,
      body: { publicKey: keyPair.publicKey, purpose: 'credentials' },
    });
  expect(challengeError).toBeUndefined();
  const signature = await cryptoService.sign(
    challengeData!.challenge,
    keyPair.privateKey,
  );
  const { data, error, response } = await recoverAgentCredentials({
    client: apiClient,
    body: {
      challenge: challengeData!.challenge,
      hmac: challengeData!.hmac,
      signature,
      publicKey: keyPair.publicKey,
    },
  });
  expect(error).toBeUndefined();
  expect(response.status).toBe(200);
  return {
    clientId: data!.clientId,
    clientSecret: openSealedEnvelope(
      data!.sealedClientSecret,
      keyPair.privateKey,
    ),
  };
}
```

Inside `describe('POST /recovery/credentials')`, after the legacy client test,
add:

```ts
it('mints an OAuth2 client for an agent registered with an agent key', async () => {
  const { keyPair, agentId } = await registerAgentKeyAgent(harness.baseUrl);

  const first = await recoverCredentials(client, keyPair);

  expect(first.clientId).toBe(`moltnet-agent-${agentId}`);
  await expect(
    requestOAuthToken(harness.baseUrl, first.clientId, first.clientSecret),
  ).resolves.toMatchObject({ status: 200 });

  const minted = await harness.hydraAdminOAuth2.getOAuth2Client({
    id: first.clientId,
  });
  expect(minted.metadata).toMatchObject({
    type: 'moltnet_agent',
    agent_id: agentId,
    public_key: keyPair.publicKey,
    fingerprint: keyPair.fingerprint,
  });
});

it('rotates rather than duplicating on a second recovery', async () => {
  const { keyPair } = await registerAgentKeyAgent(harness.baseUrl);
  const first = await recoverCredentials(client, keyPair);

  const second = await recoverCredentials(client, keyPair);

  expect(second.clientId).toBe(first.clientId);
  expect(second.clientSecret).not.toBe(first.clientSecret);
  await expect(
    requestOAuthToken(harness.baseUrl, second.clientId, second.clientSecret),
  ).resolves.toMatchObject({ status: 200 });
  await expect(
    requestOAuthToken(harness.baseUrl, first.clientId, first.clientSecret),
  ).resolves.toMatchObject({ status: 401 });
});
```

Check the exact client id prefix in
`apps/rest-api/src/utils/agent-oauth-client-id.ts` and use `agentOAuth2ClientId`
from there if the e2e project can import it; otherwise keep the literal prefix
that file defines.

- [ ] **Step 2: Start the stack with the new server image and run the suite**

Run:

```bash
pnpm run e2e:up
NX_LOAD_DOT_ENV_FILES=false pnpm exec nx run @moltnet/rest-api-e2e:e2e
```

Expected: the two new cases PASS along with the existing recovery cases. If only
the recovery file is wanted while iterating, pass the file through to Vitest:
`NX_LOAD_DOT_ENV_FILES=false pnpm exec nx run @moltnet/rest-api-e2e:e2e -- src/recovery.e2e.test.ts`.
The rest-api suite must have run once against this stack before other suites
(its setup restarts the container).

- [ ] **Step 3: Lint**

Run: `pnpm exec nx run @moltnet/rest-api-e2e:lint` Expected: success.

- [ ] **Step 4: Diary entry and commit**

```bash
git add apps/rest-api-e2e/src/recovery.e2e.test.ts
moltnet entry commit --diary-id 6e4d9948-8ec5-4f59-b82a-3acbc4bbc396 --risk low --scope "rest-api,e2e" --operator edouard --tool claude --rationale "Adds end-to-end coverage for credential recovery on an agent that registered with an agent key only: the first recovery mints the deterministic Hydra client with the webhook metadata and the returned secret obtains a token; a second recovery rotates the same client and invalidates the first secret. Run against the Docker e2e stack."
git commit -m "test(rest-api-e2e): recover credentials for an agent-key identity" -m "MoltNet-Diary: <entryId>
Task-Group: recover-or-mint-oauth2-client

Claude-Session: https://claude.ai/code/session_015FWKhcNAMs5RKTEkA3bLsS"
```

---

### Task 4: CLI defaults the destination for an agent-key identity

**Files:**

- Modify: `apps/moltnet-cli/agents_credentials.go:241-256`
- Modify: `apps/moltnet-cli/agents_credentials_test.go:57-196` (extract the test
  server) and add one test

**Interfaces:**

- Consumes: `CredentialsFile.AgentKeyRef *SecretReference`,
  `validateMigrationDestination(registry, destination)`,
  `osKeyringProviderName`, `fileProviderName`.
- Produces: `resolveRecoveryDestinationProvider(creds, requested, registry)`
  returns the agent-key provider (or `os-keyring`) when the config has no OAuth2
  client yet.

- [ ] **Step 1: Extract the recovery test server into a helper**

In `apps/moltnet-cli/agents_credentials_test.go`, move the
`httptest.NewServer(...)` block from
`TestAgentsCredentialsRecoverPersistsSealedReplacement` (lines 62-137) into:

```go
// newRecoveryTestServer serves the challenge, recovery, and token endpoints
// the recover command touches, for the given key pair. It returns the server
// and counters for the two recovery calls.
func newRecoveryTestServer(t *testing.T, keyPair *KeyPair) (*httptest.Server, *atomic.Int32, *atomic.Int32) {
	t.Helper()
	var challengeCalls atomic.Int32
	var recoveryCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/recovery/challenge":
			challengeCalls.Add(1)
			var request struct {
				PublicKey string `json:"publicKey"`
				Purpose   string `json:"purpose"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			if request.PublicKey != keyPair.PublicKey || request.Purpose != "credentials" {
				http.Error(w, "wrong public key", http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"challenge":%q,"hmac":%q}`, "moltnet:recovery:credentials:test-challenge", strings.Repeat("a", 64))
		case "/recovery/credentials":
			recoveryCalls.Add(1)
			var request struct {
				Challenge string `json:"challenge"`
				PublicKey string `json:"publicKey"`
				Signature string `json:"signature"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			if request.Challenge != "moltnet:recovery:credentials:test-challenge" ||
				request.PublicKey != keyPair.PublicKey ||
				request.Signature == "" {
				http.Error(w, "invalid proof", http.StatusBadRequest)
				return
			}
			sealed, err := EncryptForAgent("recovered-client-secret", keyPair.PublicKey)
			if err != nil {
				http.Error(w, "seal failed", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"clientId":"recovered-client-id","sealedClientSecret":%q}`, sealed)
		case "/oauth2/token":
			if err := r.ParseForm(); err != nil {
				http.Error(w, "bad form", http.StatusBadRequest)
				return
			}
			if r.Form.Get("client_id") != "recovered-client-id" ||
				r.Form.Get("client_secret") != "recovered-client-secret" {
				http.Error(w, "invalid client", http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"access_token":"verified-token","token_type":"bearer","expires_in":3600}`)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	return server, &challengeCalls, &recoveryCalls
}
```

and make the existing test call
`server, challengeCalls, recoveryCalls := newRecoveryTestServer(t, keyPair)`
(drop its `defer server.Close()`, and dereference the counters with
`challengeCalls.Load()` unchanged since they are pointers to `atomic.Int32`).

Run:
`cd apps/moltnet-cli && go test . -run 'TestAgentsCredentialsRecover' -count=1`
Expected: PASS, behavior unchanged.

- [ ] **Step 2: Write the failing test**

Append to `apps/moltnet-cli/agents_credentials_test.go`:

```go
func TestAgentsCredentialsRecoverDefaultsDestinationForAgentKeyIdentity(t *testing.T) {
	keyPair, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate key pair: %v", err)
	}
	server, _, recoveryCalls := newRecoveryTestServer(t, keyPair)

	secretRoot := t.TempDir()
	t.Setenv(secretRootEnv, secretRoot)
	t.Setenv(secretRootWritableEnv, "1")
	credentialsPath := filepath.Join(t.TempDir(), "moltnet.json")
	credentials := &CredentialsFile{
		SubjectID:   "subject-id",
		SubjectType: SubjectTypeAgent,
		AgentKeyRef: &SecretReference{Provider: fileProviderName, Key: AgentKeyKey("subject-id")},
		Keys: CredentialsKeys{
			PublicKey:   keyPair.PublicKey,
			PrivateKey:  keyPair.PrivateKey,
			Fingerprint: keyPair.Fingerprint,
		},
		Endpoints: CredentialsEndpoints{API: server.URL},
	}
	if _, err := WriteConfigTo(credentials, credentialsPath); err != nil {
		t.Fatalf("write credentials: %v", err)
	}

	root := NewRootCmd("test", "")
	_, stderr, err := executeCommand(
		root,
		"--credentials", credentialsPath,
		"agents", "credentials", "recover", "--yes",
	)
	if err != nil {
		t.Fatalf("recover without --destination: %v\nstderr: %s", err, stderr)
	}
	if recoveryCalls.Load() != 1 {
		t.Fatalf("recovery calls = %d, want 1", recoveryCalls.Load())
	}

	updated, err := ReadConfigFrom(credentialsPath)
	if err != nil {
		t.Fatalf("read recovered credentials: %v", err)
	}
	if updated.OAuth2.ClientID != "recovered-client-id" ||
		updated.OAuth2.ClientSecretRef == nil ||
		updated.OAuth2.ClientSecretRef.Provider != fileProviderName ||
		updated.OAuth2.ClientSecretRef.Key != OAuth2SecretKey("subject-id", "recovered-client-id") {
		t.Fatalf("unexpected recovered credentials: %#v", updated.OAuth2)
	}
	if updated.AgentKeyRef == nil || updated.AgentKeyRef.Key != AgentKeyKey("subject-id") {
		t.Fatalf("agent key reference was not preserved: %#v", updated.AgentKeyRef)
	}
}

func TestResolveRecoveryDestinationProviderStillRequiresFlagForPlaintextSecret(t *testing.T) {
	t.Parallel()
	creds := &CredentialsFile{
		OAuth2: CredentialsOAuth2{ClientID: "client", ClientSecret: "plaintext"},
	}

	_, err := resolveRecoveryDestinationProvider(creds, "", NewSecretProviderRegistry())

	if err == nil || !strings.Contains(err.Error(), "--destination") {
		t.Fatalf("error = %v, want --destination requirement", err)
	}
}
```

- [ ] **Step 3: Run the tests to verify the first fails**

Run:
`cd apps/moltnet-cli && go test . -run 'TestAgentsCredentialsRecoverDefaultsDestinationForAgentKeyIdentity|TestResolveRecoveryDestinationProviderStillRequiresFlagForPlaintextSecret' -count=1`
Expected: the first FAILS with
`--destination is required when oauth2.client_secret is plaintext`; the second
passes already.

- [ ] **Step 4: Implement the default**

Replace `resolveRecoveryDestinationProvider` in
`apps/moltnet-cli/agents_credentials.go` (lines 241-256) with:

```go
// resolveRecoveryDestinationProvider picks where the recovered OAuth2 secret
// is stored. An explicit --destination always wins. Otherwise the existing
// client_secret_ref provider is reused; an identity that has no OAuth2 client
// yet (agent-key only, the daemon's managed-agent shape) inherits the provider
// of its agent_key_ref, falling back to the OS keyring. A plaintext
// client_secret still needs an explicit destination because the migration
// away from plaintext is a deliberate choice.
func resolveRecoveryDestinationProvider(creds *CredentialsFile, requested string, registry *SecretProviderRegistry) (string, error) {
	if strings.TrimSpace(requested) != "" {
		return validateMigrationDestination(registry, requested)
	}
	switch {
	case creds.OAuth2.ClientSecretRef != nil:
		return validateMigrationDestination(registry, creds.OAuth2.ClientSecretRef.Provider)
	case creds.OAuth2.ClientID == "" && creds.OAuth2.ClientSecret == "":
		if creds.AgentKeyRef != nil && creds.AgentKeyRef.Provider != "" {
			return validateMigrationDestination(registry, creds.AgentKeyRef.Provider)
		}
		return validateMigrationDestination(registry, osKeyringProviderName)
	default:
		return "", fmt.Errorf("--destination is required when oauth2.client_secret is stored as plaintext; choose the provider that should hold the recovered secret")
	}
}
```

- [ ] **Step 5: Run the Go tests**

Run: `cd apps/moltnet-cli && go test ./... -count=1` Expected: PASS. Then
`cd apps/moltnet-cli && gofmt -l .` prints nothing and `go vet ./...` is clean.

- [ ] **Step 6: Diary entry and commit**

```bash
git add apps/moltnet-cli/agents_credentials.go apps/moltnet-cli/agents_credentials_test.go
moltnet entry commit --diary-id 6e4d9948-8ec5-4f59-b82a-3acbc4bbc396 --risk medium --scope "cli,auth" --operator edouard --tool claude --rationale "moltnet agents credentials recover no longer demands --destination for an identity that has no OAuth2 client yet: it reuses the agent_key_ref provider, or the OS keyring, so the command completes the recover-or-mint flow for a Console-created agent in one step. The plaintext client_secret case keeps requiring an explicit destination with a message that names that state. The shared recovery test server is extracted so the new case and the existing one exercise the same fake API."
git commit -m "fix(cli): default the recovery destination for agent-key identities" -m "MoltNet-Diary: <entryId>
Task-Group: recover-or-mint-oauth2-client
Task-Completes: true

Claude-Session: https://claude.ai/code/session_015FWKhcNAMs5RKTEkA3bLsS"
```

---

### Task 5: Pull request

- [ ] **Step 1: Push and open the PR against the OpenClaw removal branch**

```bash
git push -u origin feat/recover-or-mint-oauth2-client
moltnet github exec -- gh pr create --base worktree-chore-remove-openclaw-skill --head feat/recover-or-mint-oauth2-client \
  --title "feat(rest-api,cli): mint the OAuth2 client on credential recovery" \
  --body-file <path to a body file>
```

The body lists: what changed per commit, the spec path, the verification
commands run (unit, e2e, Go), and ends with
`https://claude.ai/code/session_015FWKhcNAMs5RKTEkA3bLsS`. Retarget the base to
`main` once PR #2259 merges.

- [ ] **Step 2: Reflection entry**

If any step needed a workaround or surprised you, write an `episodic` entry with
`moltnet entry create-signed --type episodic` before declaring the plan
complete.
