# LeGreffier Onboarding Workflow — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the LeGreffier DBOS onboarding workflow + 4 public HTTP endpoints that let a new agent register on MoltNet by installing a GitHub App with one command.

**Architecture:** A DBOS durable workflow (`legreffierOnboardingWorkflow`) orchestrates: issue a sponsor voucher → register the agent (reusing existing `registrationWorkflow.registerAgent`) → build a GitHub App manifest → wait for the OAuth callback → acknowledge completion. Four unauthenticated endpoints in `public.ts` drive the workflow from the outside: `/public/legreffier/start` (POST), `/public/legreffier/callback` (GET), `/public/legreffier/status/:workflowId` (GET), `/public/legreffier/complete` (POST). The workflow uses DBOS `setEvent`/`recv` for the async callback handshake.

**Tech Stack:** TypeScript strict, Fastify + TypeBox, DBOS (`registerStep`, `registerWorkflow`, `setEvent`, `recv`, `send`), `@moltnet/database` (VoucherRepository + registrationWorkflow), `@moltnet/auth` (RelationshipWriter), `@ory/client-fetch` (IdentityApi, OAuth2Api).

**Working directory:** `.claude/worktrees/legreffier-onboarding-workflow-287`

---

## Task 1: Config — add `RATE_LIMIT_LEGREFFIER_START` + `sponsorAgentId`

**Files:**

- Modify: `apps/rest-api/src/config.ts` (SecurityConfigSchema ~line 76)
- Modify: `apps/rest-api/src/app.ts` (SecurityOptions ~line 49)
- Modify: `apps/rest-api/src/plugins/rate-limit.ts` (RateLimitPluginOptions ~line 14)
- Modify: `apps/rest-api/src/bootstrap.ts` (security: { ... } block ~line 240)

**Step 1: Write the failing test**

Create `apps/rest-api/src/__tests__/config.test.ts` (or add to existing test if present):

```typescript
import { describe, expect, it } from 'vitest';
import { loadSecurityConfig } from '../config.js';

describe('SecurityConfig', () => {
  it('defaults RATE_LIMIT_LEGREFFIER_START to 3', () => {
    const config = loadSecurityConfig({});
    expect(config.RATE_LIMIT_LEGREFFIER_START).toBe(3);
  });

  it('accepts a valid SPONSOR_AGENT_ID UUID', () => {
    const config = loadSecurityConfig({
      SPONSOR_AGENT_ID: '00000000-0000-0000-0000-000000000001',
    });
    expect(config.SPONSOR_AGENT_ID).toBe(
      '00000000-0000-0000-0000-000000000001',
    );
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.claude/worktrees/legreffier-onboarding-workflow-287
pnpm --filter @moltnet/rest-api run test -- --reporter=verbose 2>&1 | grep -A5 "RATE_LIMIT_LEGREFFIER"
```

Expected: test file not found or property missing.

**Step 3: Add `RATE_LIMIT_LEGREFFIER_START` to `SecurityConfigSchema` in `config.ts`**

In `apps/rest-api/src/config.ts`, add after `RATE_LIMIT_PUBLIC_SEARCH`:

```typescript
  RATE_LIMIT_LEGREFFIER_START: Type.Number({ default: 3 }),
```

**Step 4: Add `rateLimitLegreffierStart` to `SecurityOptions` in `app.ts`**

In `apps/rest-api/src/app.ts`, add after `rateLimitPublicSearch`:

```typescript
  /** Max requests per day for LeGreffier onboarding start (default: 3) */
  rateLimitLegreffierStart: number;
  /** Sponsor agent identity ID for issuing vouchers */
  sponsorAgentId?: string;
```

**Step 5: Add `legreffierStartLimit` to `RateLimitPluginOptions` and `rateLimitConfig` in `rate-limit.ts`**

In `apps/rest-api/src/plugins/rate-limit.ts`:

Add to `RateLimitPluginOptions`:

```typescript
/** Max requests per day for LeGreffier onboarding start (default: 3) */
legreffierStartLimit: number;
```

Add to `rateLimitPluginImpl` destructuring:

```typescript
legreffierStartLimit,
```

Add to `fastify.decorate('rateLimitConfig', { ... })`:

```typescript
    legreffierStart: {
      max: legreffierStartLimit,
      timeWindow: '1 day',
    },
```

Add to `FastifyInstance` type augmentation:

```typescript
legreffierStart: {
  max: number;
  timeWindow: string;
}
```

**Step 6: Wire in `bootstrap.ts`**

In the `security: { ... }` block (around line 240), add:

```typescript
      rateLimitLegreffierStart: config.security.RATE_LIMIT_LEGREFFIER_START,
      sponsorAgentId: config.security.SPONSOR_AGENT_ID,
```

**Step 7: Wire rate limit plugin in `app.ts` `registerApiRoutes`**

In `apps/rest-api/src/app.ts`, in the `rateLimitPlugin` registration call, add:

```typescript
      legreffierStartLimit: options.security.rateLimitLegreffierStart,
```

Also add `sponsorAgentId` decoration after the existing decorateSafe calls:

```typescript
decorateSafe('sponsorAgentId', options.security.sponsorAgentId);
```

Add to Fastify type augmentation (in `app.ts` or a separate `types.d.ts`):

```typescript
declare module 'fastify' {
  interface FastifyInstance {
    sponsorAgentId: string | undefined;
  }
}
```

**Step 8: Run tests**

```bash
pnpm --filter @moltnet/rest-api run test 2>&1 | tail -20
```

Expected: all existing tests pass + new config tests pass.

**Step 9: Commit**

```bash
git add apps/rest-api/src/config.ts apps/rest-api/src/app.ts \
        apps/rest-api/src/plugins/rate-limit.ts apps/rest-api/src/bootstrap.ts \
        apps/rest-api/src/__tests__/
git commit -m "feat(rest-api): add RATE_LIMIT_LEGREFFIER_START config and sponsorAgentId decoration"
```

---

## Task 2: Onboarding workflow — `legreffier-onboarding-workflow.ts`

**Files:**

- Create: `apps/rest-api/src/workflows/legreffier-onboarding-workflow.ts`
- Modify: `apps/rest-api/src/workflows/index.ts`

### Context

The workflow mirrors the structure of `registration-workflow.ts`: a module-level `_workflow` variable initialized by `initLegreffierOnboardingWorkflow()`, deps injected via `setLegreffierOnboardingDeps()`.

Flow:

1. `issueVoucherStep(sponsorAgentId)` — calls `voucherRepository.issueUnlimited(sponsorAgentId)` → returns `voucherCode`
2. `registerAgentStep(publicKey, fingerprint, voucherCode)` — calls `registrationWorkflow.registerAgent(publicKey, fingerprint, voucherCode)` → returns `RegistrationResult`
3. `buildManifestStep(identityId, callbackUrl)` — builds GitHub App manifest JSON → returns manifest object
4. `waitForGithubCallbackStep` → `DBOS.recv<string>('github_code', GITHUB_CALLBACK_TIMEOUT_S)` — returns `githubCode` (null on timeout)
5. If `githubCode` is null: void voucher + delete Kratos identity (compensation), throw `OnboardingTimeoutError`
6. `setGithubCodeReadyEvent(workflowId, githubCode)` — `DBOS.setEvent('github_code_ready', githubCode)` (for status polling)
7. `waitForCompleteAckStep` → `DBOS.recv<boolean>('complete_ack', COMPLETE_ACK_TIMEOUT_S)` — waits for the agent to call `/complete`
8. Return final result with `identityId`, `clientId`, `clientSecret`, GitHub installation data

### Event names (constants)

```
GITHUB_CODE_EVENT = 'github_code'
GITHUB_CODE_READY_EVENT = 'github_code_ready'
COMPLETE_ACK_EVENT = 'complete_ack'
STATUS_EVENT = 'status'
```

### Step 1: Write the tests first

Create `apps/rest-api/src/workflows/__tests__/legreffier-onboarding-workflow.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock DBOS before importing the module
vi.mock('@moltnet/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moltnet/database')>();
  return {
    ...actual,
    DBOS: {
      registerStep: vi.fn((fn, _opts) => fn),
      registerWorkflow: vi.fn((fn, _opts) => fn),
      recv: vi.fn(),
      setEvent: vi.fn(),
      send: vi.fn(),
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    },
  };
});

// Mock registration workflow
vi.mock('../registration-workflow.js', () => ({
  registrationWorkflow: {
    get registerAgent() {
      return mockRegisterAgent;
    },
  },
}));

const mockRegisterAgent = vi.fn();

import {
  initLegreffierOnboardingWorkflow,
  OnboardingTimeoutError,
  setLegreffierOnboardingDeps,
} from '../legreffier-onboarding-workflow.js';

describe('initLegreffierOnboardingWorkflow', () => {
  it('is idempotent — calling twice does not throw', () => {
    initLegreffierOnboardingWorkflow();
    expect(() => initLegreffierOnboardingWorkflow()).not.toThrow();
  });
});

describe('setLegreffierOnboardingDeps', () => {
  it('sets deps without throwing', () => {
    const deps = {
      voucherRepository: { issueUnlimited: vi.fn() } as any,
      identityApi: { deleteIdentity: vi.fn() } as any,
    };
    expect(() => setLegreffierOnboardingDeps(deps)).not.toThrow();
  });
});

describe('OnboardingTimeoutError', () => {
  it('has correct name', () => {
    const err = new OnboardingTimeoutError('timed out');
    expect(err.name).toBe('OnboardingTimeoutError');
    expect(err.message).toBe('timed out');
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
pnpm --filter @moltnet/rest-api run test -- --reporter=verbose 2>&1 | grep -A5 "legreffier"
```

Expected: import fails (module doesn't exist yet).

**Step 3: Implement the workflow module**

Create `apps/rest-api/src/workflows/legreffier-onboarding-workflow.ts`:

```typescript
/**
 * LeGreffier Onboarding Durable Workflow
 *
 * DBOS workflow for the one-command agent onboarding via GitHub App.
 *
 * Steps:
 * 1. Issue sponsor voucher
 * 2. Register agent (reuses registrationWorkflow.registerAgent)
 * 3. Build GitHub App manifest
 * 4. Wait for GitHub OAuth callback (recv github_code)
 * 5. If timeout: compensate (void voucher + delete Kratos identity)
 * 6. Signal github_code_ready (for status polling)
 * 7. Wait for complete ack from agent
 * 8. Return result
 */

import { DBOS, type VoucherRepository } from '@moltnet/database';
import type { IdentityApi } from '@ory/client-fetch';

import {
  registrationWorkflow,
  type RegistrationResult,
} from './registration-workflow.js';

// ── Constants ──────────────────────────────────────────────────

const GITHUB_CODE_EVENT = 'github_code';
const GITHUB_CODE_READY_EVENT = 'github_code_ready';
const COMPLETE_ACK_EVENT = 'complete_ack';
const GITHUB_CALLBACK_TIMEOUT_S = 600; // 10 minutes
const COMPLETE_ACK_TIMEOUT_S = 3600; // 1 hour

// ── Error Classes ──────────────────────────────────────────────

export class OnboardingTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnboardingTimeoutError';
  }
}

export class OnboardingWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnboardingWorkflowError';
  }
}

// ── Types ──────────────────────────────────────────────────────

export interface LegreffierOnboardingDeps {
  voucherRepository: VoucherRepository;
  identityApi: IdentityApi;
}

export interface OnboardingResult extends RegistrationResult {
  workflowId: string;
}

export interface GitHubAppManifest {
  name: string;
  url: string;
  hook_attributes: { url: string; active: boolean };
  redirect_url: string;
  callback_urls: string[];
  description: string;
  public: boolean;
  default_permissions: Record<string, string>;
  default_events: string[];
}

// ── Dependency Injection ───────────────────────────────────────

let deps: LegreffierOnboardingDeps | null = null;

export function setLegreffierOnboardingDeps(d: LegreffierOnboardingDeps): void {
  deps = d;
}

function getDeps(): LegreffierOnboardingDeps {
  if (!deps) {
    throw new Error(
      'LeGreffier onboarding deps not set. Call setLegreffierOnboardingDeps() ' +
        'before using onboarding workflows.',
    );
  }
  return deps;
}

// ── Lazy Registration ──────────────────────────────────────────

type StartOnboardingFn = (
  publicKey: string,
  fingerprint: string,
  sponsorAgentId: string,
  apiBaseUrl: string,
) => Promise<OnboardingResult>;

let _workflow: StartOnboardingFn | null = null;

export function initLegreffierOnboardingWorkflow(): void {
  if (_workflow) return;

  // ── Steps ────────────────────────────────────────────────────

  const issueVoucherStep = DBOS.registerStep(
    async (sponsorAgentId: string): Promise<string> => {
      const { voucherRepository } = getDeps();
      return voucherRepository.issueUnlimited(sponsorAgentId);
    },
    {
      name: 'legreffier.step.issueVoucher',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const registerAgentStep = DBOS.registerStep(
    async (
      publicKey: string,
      fingerprint: string,
      voucherCode: string,
    ): Promise<RegistrationResult> => {
      return registrationWorkflow.registerAgent(
        publicKey,
        fingerprint,
        voucherCode,
      );
    },
    {
      name: 'legreffier.step.registerAgent',
      retriesAllowed: false,
    },
  );

  const buildManifestStep = DBOS.registerStep(
    async (
      identityId: string,
      apiBaseUrl: string,
    ): Promise<GitHubAppManifest> => {
      const callbackUrl = `${apiBaseUrl}/public/legreffier/callback`;
      return {
        name: `MoltNet Agent ${identityId.slice(0, 8)}`,
        url: 'https://themolt.net',
        hook_attributes: {
          url: `${apiBaseUrl}/hooks/github`,
          active: false,
        },
        redirect_url: callbackUrl,
        callback_urls: [callbackUrl],
        description: 'MoltNet agent identity — cryptographic autonomy for AI',
        public: false,
        default_permissions: {
          contents: 'read',
          metadata: 'read',
        },
        default_events: ['push'],
      };
    },
    {
      name: 'legreffier.step.buildManifest',
      retriesAllowed: false,
    },
  );

  const deleteKratosIdentityStep = DBOS.registerStep(
    async (identityId: string): Promise<void> => {
      const { identityApi } = getDeps();
      await identityApi.deleteIdentity({ id: identityId });
    },
    {
      name: 'legreffier.step.deleteKratosIdentity',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  // ── Workflow ─────────────────────────────────────────────────

  _workflow = DBOS.registerWorkflow(
    async (
      publicKey: string,
      fingerprint: string,
      sponsorAgentId: string,
      apiBaseUrl: string,
    ): Promise<OnboardingResult> => {
      const workflowId = DBOS.workflowID;

      // Step 1: Issue voucher from sponsor
      const voucherCode = await issueVoucherStep(sponsorAgentId);

      // Step 2: Register agent (creates Kratos identity + Keto + OAuth2 client)
      const registration = await registerAgentStep(
        publicKey,
        fingerprint,
        voucherCode,
      );

      // Step 3: Build GitHub App manifest (for informational use by caller)
      await buildManifestStep(registration.identityId, apiBaseUrl);

      // Step 4: Wait for GitHub OAuth callback
      const githubCode = await DBOS.recv<string>(
        GITHUB_CODE_EVENT,
        GITHUB_CALLBACK_TIMEOUT_S,
      );

      if (!githubCode) {
        // Compensation: delete Kratos identity on timeout
        DBOS.logger.error(
          `LeGreffier onboarding timed out waiting for GitHub callback ` +
            `(workflowId=${workflowId}, identityId=${registration.identityId}). ` +
            `Compensating.`,
        );
        try {
          await deleteKratosIdentityStep(registration.identityId);
        } catch (err) {
          DBOS.logger.error(
            `Compensation failed: could not delete Kratos identity ` +
              `(identityId=${registration.identityId}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        throw new OnboardingTimeoutError(
          'Timed out waiting for GitHub App installation callback',
        );
      }

      // Step 5: Signal github_code_ready (allows status endpoint to return it)
      await DBOS.setEvent(GITHUB_CODE_READY_EVENT, githubCode);

      // Step 6: Wait for agent to acknowledge completion
      await DBOS.recv<boolean>(COMPLETE_ACK_EVENT, COMPLETE_ACK_TIMEOUT_S);

      return {
        ...registration,
        workflowId,
      };
    },
    { name: 'legreffier.startOnboarding' },
  );
}

// ── Exported Collection ────────────────────────────────────────

export const legreffierOnboardingWorkflow = {
  get startOnboarding() {
    if (!_workflow) {
      throw new Error(
        'LeGreffier onboarding workflow not initialized. ' +
          'Call initLegreffierOnboardingWorkflow() after configureDBOS().',
      );
    }
    return _workflow;
  },
};

export { GITHUB_CODE_EVENT, GITHUB_CODE_READY_EVENT, COMPLETE_ACK_EVENT };
```

**Step 4: Export from `workflows/index.ts`**

In `apps/rest-api/src/workflows/index.ts`, add:

```typescript
export {
  initLegreffierOnboardingWorkflow,
  legreffierOnboardingWorkflow,
  setLegreffierOnboardingDeps,
  OnboardingTimeoutError,
  OnboardingWorkflowError,
  GITHUB_CODE_EVENT,
  GITHUB_CODE_READY_EVENT,
  COMPLETE_ACK_EVENT,
  type LegreffierOnboardingDeps,
  type OnboardingResult,
  type GitHubAppManifest,
} from './legreffier-onboarding-workflow.js';
```

**Step 5: Run tests**

```bash
pnpm --filter @moltnet/rest-api run test -- --reporter=verbose 2>&1 | tail -30
```

Expected: workflow tests pass.

**Step 6: Commit**

```bash
git add apps/rest-api/src/workflows/
git commit -m "feat(rest-api): add LeGreffier onboarding DBOS workflow"
```

---

## Task 3: Register workflow in `bootstrap.ts`

**Files:**

- Modify: `apps/rest-api/src/bootstrap.ts`

**Step 1: Add imports at top of `bootstrap.ts`**

After the existing `initRegistrationWorkflow, setRegistrationDeps` import:

```typescript
import {
  initLegreffierOnboardingWorkflow,
  setLegreffierOnboardingDeps,
} from './workflows/index.js';
```

**Step 2: Register in `registerWorkflows` array**

Add after `() => initRegistrationWorkflow()`:

```typescript
      () => initLegreffierOnboardingWorkflow(),
```

**Step 3: Set deps in `afterLaunch` array**

Add after the `setRegistrationDeps` block:

```typescript
      (_dataSource) => {
        setLegreffierOnboardingDeps({
          voucherRepository,
          identityApi: oryClients.identity,
        });
      },
```

**Step 4: Run typecheck**

```bash
pnpm --filter @moltnet/rest-api run typecheck 2>&1 | tail -20
```

Expected: no errors.

**Step 5: Commit**

```bash
git add apps/rest-api/src/bootstrap.ts
git commit -m "feat(rest-api): register LeGreffier onboarding workflow in bootstrap"
```

---

## Task 4: Public endpoints in `public.ts`

**Files:**

- Modify: `apps/rest-api/src/routes/public.ts`

### Endpoint overview

| Method | Path                                    | Description                                                                                              |
| ------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| POST   | `/public/legreffier/start`              | Start onboarding — validates sponsor, launches workflow, returns `workflowId` + GitHub manifest form URL |
| GET    | `/public/legreffier/callback`           | GitHub redirects here after App install — sends `github_code` to workflow via `DBOS.send`                |
| GET    | `/public/legreffier/status/:workflowId` | Poll workflow status — returns current state or `github_code_ready` event value                          |
| POST   | `/public/legreffier/complete`           | Agent sends this to send the `complete_ack` event and finalize                                           |

### TypeBox schemas (inline in file)

```typescript
const StartOnboardingBody = Type.Object({
  publicKey: Type.String({ minLength: 1 }),
  fingerprint: Type.String({ minLength: 1 }),
});

const StartOnboardingResponse = Type.Object({
  workflowId: Type.String(),
  manifestFormUrl: Type.String(),
  manifest: Type.Unknown(),
});

const OnboardingStatusResponse = Type.Object({
  status: Type.Union([
    Type.Literal('pending'),
    Type.Literal('awaiting_github'),
    Type.Literal('github_code_ready'),
    Type.Literal('completed'),
    Type.Literal('failed'),
  ]),
  githubCode: Type.Optional(Type.String()),
});

const CompleteOnboardingBody = Type.Object({
  workflowId: Type.String({ minLength: 1 }),
});
```

### `POST /public/legreffier/start`

```typescript
server.post(
  '/public/legreffier/start',
  {
    config: { rateLimit: fastify.rateLimitConfig.legreffierStart },
    schema: {
      operationId: 'startLegreffierOnboarding',
      tags: ['legreffier'],
      description:
        'Start LeGreffier one-command onboarding. Issues a sponsor voucher, ' +
        'registers the agent, and returns a GitHub App manifest installation URL.',
      body: StartOnboardingBody,
      response: {
        200: StartOnboardingResponse,
        503: Type.Ref(ProblemDetailsSchema),
      },
    },
  },
  async (request, reply) => {
    if (!fastify.sponsorAgentId) {
      throw createProblem(
        'service-unavailable',
        'LeGreffier onboarding is not configured on this server',
      );
    }
    const { publicKey, fingerprint } = request.body;
    const apiBaseUrl = `${request.protocol}://${request.hostname}`;

    const workflowHandle = await DBOS.startWorkflow(
      legreffierOnboardingWorkflow.startOnboarding,
    )(publicKey, fingerprint, fastify.sponsorAgentId, apiBaseUrl);

    const workflowId = workflowHandle.workflowID;

    // Build manifest for response (same logic as workflow step, but sync here for immediate response)
    const manifest: GitHubAppManifest = {
      name: `MoltNet Agent ${fingerprint.slice(0, 8)}`,
      url: 'https://themolt.net',
      hook_attributes: {
        url: `${apiBaseUrl}/hooks/github`,
        active: false,
      },
      redirect_url: `${apiBaseUrl}/public/legreffier/callback`,
      callback_urls: [`${apiBaseUrl}/public/legreffier/callback`],
      description: 'MoltNet agent identity — cryptographic autonomy for AI',
      public: false,
      default_permissions: { contents: 'read', metadata: 'read' },
      default_events: ['push'],
    };

    const manifestJson = encodeURIComponent(JSON.stringify(manifest));
    const manifestFormUrl = `https://github.com/settings/apps/new?state=${workflowId}&manifest=${manifestJson}`;

    return reply.send({ workflowId, manifestFormUrl, manifest });
  },
);
```

### `GET /public/legreffier/callback`

GitHub redirects to this with `?code=XXX&state=workflowId`:

```typescript
server.get(
  '/public/legreffier/callback',
  {
    schema: {
      operationId: 'legreffierGithubCallback',
      tags: ['legreffier'],
      description:
        'GitHub App installation callback. Forwards the OAuth code to the waiting workflow.',
      querystring: Type.Object({
        code: Type.String({ minLength: 1 }),
        state: Type.String({ minLength: 1 }),
      }),
      response: {
        200: Type.Object({ ok: Type.Boolean() }),
        400: Type.Ref(ProblemDetailsSchema),
        404: Type.Ref(ProblemDetailsSchema),
      },
    },
  },
  async (request, reply) => {
    const { code, state: workflowId } = request.query;
    await DBOS.send(workflowId, code, GITHUB_CODE_EVENT);
    return reply.send({ ok: true });
  },
);
```

### `GET /public/legreffier/status/:workflowId`

```typescript
server.get(
  '/public/legreffier/status/:workflowId',
  {
    schema: {
      operationId: 'legreffierOnboardingStatus',
      tags: ['legreffier'],
      description: 'Poll onboarding workflow status.',
      params: Type.Object({ workflowId: Type.String({ minLength: 1 }) }),
      response: {
        200: OnboardingStatusResponse,
        404: Type.Ref(ProblemDetailsSchema),
      },
    },
  },
  async (request, reply) => {
    const { workflowId } = request.params;
    const handle = DBOS.retrieveWorkflow<OnboardingResult>(workflowId);
    const status = await handle.getStatus();

    if (!status) {
      throw createProblem('not-found', 'Onboarding workflow not found');
    }

    if (status.status === 'SUCCESS') {
      return reply.send({ status: 'completed' });
    }
    if (status.status === 'ERROR') {
      return reply.send({ status: 'failed' });
    }

    // Check if github_code_ready event was set
    const githubCode = await handle.getEvent<string>(GITHUB_CODE_READY_EVENT);
    if (githubCode) {
      return reply.send({ status: 'github_code_ready', githubCode });
    }

    return reply.send({ status: 'awaiting_github' });
  },
);
```

### `POST /public/legreffier/complete`

```typescript
server.post(
  '/public/legreffier/complete',
  {
    schema: {
      operationId: 'completeLegreffierOnboarding',
      tags: ['legreffier'],
      description:
        'Agent calls this to acknowledge completion of GitHub App installation.',
      body: CompleteOnboardingBody,
      response: {
        200: Type.Object({ ok: Type.Boolean() }),
        404: Type.Ref(ProblemDetailsSchema),
      },
    },
  },
  async (request, reply) => {
    const { workflowId } = request.body;
    await DBOS.send(workflowId, true, COMPLETE_ACK_EVENT);
    return reply.send({ ok: true });
  },
);
```

**Step 1: Write tests for the new endpoints**

Create `apps/rest-api/src/__tests__/legreffier-routes.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildApp } from '../app.js';
import type { AppOptions } from '../app.js';

// Mock DBOS
vi.mock('@moltnet/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moltnet/database')>();
  return {
    ...actual,
    DBOS: {
      startWorkflow: vi.fn(() =>
        vi.fn().mockResolvedValue({ workflowID: 'wf-test-123' }),
      ),
      send: vi.fn().mockResolvedValue(undefined),
      retrieveWorkflow: vi.fn(() => ({
        getStatus: vi.fn().mockResolvedValue({ status: 'PENDING' }),
        getEvent: vi.fn().mockResolvedValue(null),
      })),
    },
  };
});

vi.mock('../workflows/index.js', () => ({
  legreffierOnboardingWorkflow: {
    get startOnboarding() {
      return vi.fn();
    },
  },
  GITHUB_CODE_EVENT: 'github_code',
  GITHUB_CODE_READY_EVENT: 'github_code_ready',
  COMPLETE_ACK_EVENT: 'complete_ack',
  initRegistrationWorkflow: vi.fn(),
  registrationWorkflow: { registerAgent: vi.fn() },
}));

function buildTestOptions(overrides?: Partial<AppOptions>): AppOptions {
  return {
    diaryService: {} as any,
    diaryEntryRepository: {} as any,
    embeddingService: {} as any,
    agentRepository: {} as any,
    cryptoService: {} as any,
    voucherRepository: {} as any,
    signingRequestRepository: {} as any,
    nonceRepository: {} as any,
    dataSource: {} as any,
    transactionRunner: {} as any,
    permissionChecker: {} as any,
    relationshipWriter: {} as any,
    tokenValidator: { validate: vi.fn() } as any,
    hydraPublicUrl: 'http://localhost:4444',
    webhookApiKey: 'test-key',
    recoverySecret: '0000000000000000',
    oryClients: {
      oauth2: {} as any,
      identity: {} as any,
      relationship: {} as any,
      permission: {} as any,
    } as any,
    security: {
      corsOrigins: 'http://localhost:3000',
      rateLimitGlobalAuth: 100,
      rateLimitGlobalAnon: 30,
      rateLimitEmbedding: 20,
      rateLimitVouch: 10,
      rateLimitSigning: 5,
      rateLimitRecovery: 5,
      rateLimitPublicVerify: 10,
      rateLimitPublicSearch: 15,
      rateLimitLegreffierStart: 3,
      sponsorAgentId: '00000000-0000-0000-0000-000000000001',
    },
    ...overrides,
  };
}

describe('POST /public/legreffier/start', () => {
  it('returns 503 when sponsorAgentId is not set', async () => {
    const app = await buildApp(
      buildTestOptions({
        security: { ...buildTestOptions().security, sponsorAgentId: undefined },
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/public/legreffier/start',
      payload: { publicKey: 'ed25519:abc', fingerprint: 'fp:123' },
    });
    expect(response.statusCode).toBe(503);
  });

  it('returns 200 with workflowId and manifestFormUrl when sponsorAgentId is set', async () => {
    const app = await buildApp(buildTestOptions());
    const response = await app.inject({
      method: 'POST',
      url: '/public/legreffier/start',
      payload: { publicKey: 'ed25519:abc', fingerprint: 'fp:123' },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('workflowId');
    expect(body).toHaveProperty('manifestFormUrl');
    expect(body.manifestFormUrl).toContain('github.com/settings/apps/new');
  });
});

describe('GET /public/legreffier/callback', () => {
  it('returns 200 ok when code and state are provided', async () => {
    const app = await buildApp(buildTestOptions());
    const response = await app.inject({
      method: 'GET',
      url: '/public/legreffier/callback?code=gh-code-xyz&state=wf-test-123',
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });
});

describe('GET /public/legreffier/status/:workflowId', () => {
  it('returns status awaiting_github for PENDING workflow', async () => {
    const app = await buildApp(buildTestOptions());
    const response = await app.inject({
      method: 'GET',
      url: '/public/legreffier/status/wf-test-123',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('awaiting_github');
  });
});

describe('POST /public/legreffier/complete', () => {
  it('returns 200 ok', async () => {
    const app = await buildApp(buildTestOptions());
    const response = await app.inject({
      method: 'POST',
      url: '/public/legreffier/complete',
      payload: { workflowId: 'wf-test-123' },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
pnpm --filter @moltnet/rest-api run test -- --reporter=verbose 2>&1 | grep -A5 "legreffier-routes"
```

Expected: test file errors because routes don't exist yet.

**Step 3: Add required imports to `public.ts`**

Add at the top of `apps/rest-api/src/routes/public.ts`:

```typescript
import { DBOS } from '@moltnet/database';
import {
  legreffierOnboardingWorkflow,
  GITHUB_CODE_EVENT,
  GITHUB_CODE_READY_EVENT,
  COMPLETE_ACK_EVENT,
  type GitHubAppManifest,
  type OnboardingResult,
} from '../workflows/index.js';
```

Add `createProblem` is already imported. Add `ProblemDetailsSchema` if not already imported.

**Step 4: Add schema definitions and 4 route handlers** inside `publicRoutes` function (after existing routes), using the code from the Endpoint overview above.

**Step 5: Register `sponsorAgentId` in Fastify type augmentation**

Since we add `sponsorAgentId` as a decoration in `app.ts`, add to a type augmentation if not done in Task 1. The `app.ts` approach with `declareSafe` means we need:

```typescript
// In app.ts or a dedicated augmentation
declare module 'fastify' {
  interface FastifyInstance {
    sponsorAgentId: string | undefined;
  }
}
```

**Step 6: Run tests**

```bash
pnpm --filter @moltnet/rest-api run test -- --reporter=verbose 2>&1 | tail -40
```

Expected: all route tests pass.

**Step 7: Commit**

```bash
git add apps/rest-api/src/routes/public.ts apps/rest-api/src/__tests__/
git commit -m "feat(rest-api): add LeGreffier onboarding public endpoints"
```

---

## Task 5: Full validation

**Step 1: Run lint**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.claude/worktrees/legreffier-onboarding-workflow-287
pnpm run lint 2>&1 | tail -20
```

Expected: no errors.

**Step 2: Run typecheck**

```bash
pnpm run typecheck 2>&1 | tail -20
```

Expected: no errors.

**Step 3: Run all tests**

```bash
pnpm run test 2>&1 | tail -30
```

Expected: all tests pass.

**Step 4: Fix any issues found, commit fixes**

```bash
git add -A
git commit -m "fix(rest-api): address lint/typecheck issues in LeGreffier onboarding"
```

---

## Task 6: Journal + Handoff

**Step 1: Write journal entry**

Create `docs/journal/YYYY-MM-DD-legreffier-onboarding-workflow.md` following `docs/BUILDER_JOURNAL.md` format. Entry type: `handoff`. Cover:

- What was built (4 endpoints + DBOS workflow)
- DBOS `startWorkflow` pattern used for `start` endpoint
- Event names exported for use in tests
- `sponsorAgentId` optional — server starts without it but `/start` returns 503
- Compensation: on GitHub callback timeout, Kratos identity is deleted

**Step 2: Update journal index**

Add entry to `docs/journal/README.md`.

**Step 3: Commit**

```bash
git add docs/journal/
git commit -m "docs: journal handoff for LeGreffier onboarding workflow (issue #287)"
```

**Step 4: Signal ready for PR**

```bash
jq --arg summary "Add LeGreffier onboarding DBOS workflow and 4 public endpoints for one-command agent registration" \
   --arg branch "$(git branch --show-current)" \
   '.phase = "ready_for_pr" | .summary = $summary | .branch = $branch | .status = "In Review"' \
   .agent-claim.json > .agent-claim.json.tmp && mv .agent-claim.json.tmp .agent-claim.json
```

---

## Notes for Implementer

### DBOS API patterns

- **Start workflow:** `DBOS.startWorkflow(fn)(...args)` returns a `WorkflowHandle`
- **Send event to workflow:** `DBOS.send(workflowId, payload, topic)`
- **Retrieve workflow:** `DBOS.retrieveWorkflow<ResultType>(workflowId)`
- **Get event from outside:** `handle.getEvent<T>(eventName)` — returns null if not set yet
- **Get status:** `handle.getStatus()` — returns `{ status: 'PENDING' | 'SUCCESS' | 'ERROR' | ... }`
- **Inside workflow, recv:** `DBOS.recv<T>(topic, timeoutSeconds)` — returns null on timeout
- **Inside workflow, setEvent:** `DBOS.setEvent(eventName, value)` — for external status polling

### GitHub App manifest redirect

GitHub redirects to `redirect_url` with `?code=XXX&state=WHATEVER_YOU_PASSED`. We pass the `workflowId` as `state` in the manifest form URL so the callback knows which workflow to unblock.

### `sponsorAgentId` required for `/start`

The `sponsorAgentId` decoration is `string | undefined`. The `/start` handler checks it and returns 503 if unset — this lets the server start without a sponsor agent configured.

### Problem registry

Use `createProblem('service-unavailable', ...)` and `createProblem('not-found', ...)`. Check `apps/rest-api/src/problems/registry.ts` to verify these type keys exist.
