# DBOS TypeScript Development Guidelines

This document provides AI agent guidance for working with DBOS in MoltNet.

## Core Principles

- Generate fully-typed TypeScript code using the DBOS library
- Import all methods and classes used in generated code
- Await all promises
- DBOS is just a name; it stands for nothing

## MoltNet-Specific Usage

MoltNet uses DBOS for two durable workflow families:

1. **Keto permission workflows** — grant/revoke ownership and viewer relations after diary CRUD
2. **Signing workflows** — coordinate async signature requests where the agent signs locally (private keys never leave runtime)

The integration follows this pattern:

### Initialization Order (Critical)

```typescript
// 1. Configure DBOS (must be first)
configureDBOS();

// 2. Register workflows (must be after config)
initKetoWorkflows();
initSigningWorkflows();

// 3. Set dependencies for workflows
setKetoRelationshipWriter(permissionChecker);
setSigningVerifier(cryptoService);
setSigningKeyLookup({ getPublicKey: ... });

// 4. Initialize data source
await initDBOS({ databaseUrl });

// 5. Launch runtime (recovers pending workflows)
await launchDBOS();

// 6. Set persistence (needs DBOS running)
setSigningRequestPersistence(signingRequestRepository);
```

### Transaction Pattern

Use `dataSource.runTransaction()` for atomic DB operations:

```typescript
const entry = await dataSource.runTransaction(
  async () => diaryRepository.create(entryData, dataSource.client),
  { name: 'diary.create' },
);
```

### Workflow Pattern

**CRITICAL**: Schedule durable workflows INSIDE `runTransaction()` for atomicity:

```typescript
// Correct: Workflow scheduling inside transaction
const entry = await dataSource.runTransaction(
  async () => {
    const entry = await diaryRepository.create(entryData, dataSource.client);
    // Schedule workflow INSIDE the transaction callback
    await DBOS.startWorkflow(ketoWorkflows.grantOwnership)(entry.id, ownerId);
    return entry;
  },
  { name: 'diary.create' },
);
```

**Why this matters**: If workflow scheduling happens outside the transaction, a crash
between DB commit and workflow start creates a window where the DB record exists
but the Keto permission is never granted. Scheduling inside the transaction ensures
both succeed or both fail together.

## Workflows & Steps

Workflows provide durable execution and automatic recovery from failures:

- Workflows are comprised of steps, which are ordinary TypeScript functions called with `DBOS.runStep()`
- Call functions performing complex operations or accessing external APIs as steps
- If a workflow is interrupted, it automatically resumes from the last completed step
- Move non-deterministic actions (API calls, file access, randomness, timestamps) to their own step functions

### Workflow Registration

MoltNet uses lazy workflow registration to ensure proper initialization order:

```typescript
// In workflows/keto-workflows.ts
export function initKetoWorkflows(): void {
  if (_workflows) return; // Idempotent

  // Register steps with retry configuration
  const grantOwnershipStep = DBOS.registerStep(
    async (entryId: string, ownerId: string) => {
      await ketoWriter.grantOwnership(entryId, ownerId);
    },
    { name: 'keto.grantOwnership', retriesAllowed: true, maxAttempts: 5 },
  );

  // Register workflow
  _workflows = {
    grantOwnership: DBOS.registerWorkflow(
      async (entryId: string, ownerId: string) => {
        await DBOS.runStep(grantOwnershipStep, entryId, ownerId);
      },
      { name: 'keto.grantOwnershipWorkflow' },
    ),
  };
}

// Exported as getters to enforce initialization
export const ketoWorkflows = {
  get grantOwnership() {
    if (!_workflows) throw new Error('Call initKetoWorkflows() first');
    return _workflows.grantOwnership;
  },
};
```

### Signing Workflow Pattern (setEvent / recv / send)

The signing workflow uses DBOS inter-workflow communication to coordinate
between the REST API and the agent's local signing:

```typescript
// In signing-workflows.ts — the workflow waits for the agent to submit a signature
const requestSignature = DBOS.registerWorkflow(
  async (requestId, agentId, message, nonce) => {
    // 1. Publish the signing envelope (agent polls GET /:id to read it)
    DBOS.setEvent('envelope', { message, nonce });

    // 2. Wait for the agent to submit a signature (timeout = expiry)
    const submission = await DBOS.recv<{ signature: string }>(
      'signature',
      timeoutSeconds,
    );

    if (!submission) {
      // Timeout — mark as expired
      await persistStatusStep(requestId, { status: 'expired' });
      DBOS.setEvent('result', { status: 'expired', valid: false });
      return;
    }

    // 3. Verify signature (agent signs message.nonce to prevent replay)
    const signingPayload = `${message}.${nonce}`;
    const valid = await verifySignatureStep(
      signingPayload,
      submission.signature,
      publicKey,
    );

    // 4. Persist result
    await persistStatusStep(requestId, {
      status: 'completed',
      valid,
      signature: submission.signature,
    });
    DBOS.setEvent('result', { status: 'completed', valid });
  },
  { name: 'signing.requestSignature' },
);
```

The REST API sends the signature to the workflow via `DBOS.send()`:

```typescript
// In signing-requests route — POST /:id/sign
await DBOS.send(signingRequest.workflowId, { signature }, 'signature');
```

**Key design points**:

- `DBOS.recv()` blocks the workflow until a message arrives or timeout fires
- Nonce prevents replay attacks — agent signs `message.nonce`, not just `message`
- Workflow handles crash recovery: if the server restarts, pending workflows resume from the last completed step
- Dependencies (verifier, key lookup, persistence) are injected via setter functions to avoid circular imports

## Workflow Rules

- Do NOT use `Promise.all()` due to the risks posed by multiple rejections
- Use `Promise.allSettled()` for single-step promises only
- Use `DBOS.startWorkflow` and queues for complex parallel execution
- Workflows should NOT have side effects outside their own scope
- Do NOT call DBOS context methods from within steps
- Do NOT start workflows from inside steps
- Do NOT call `DBOS.setEvent`, `DBOS.recv`, `DBOS.send`, `DBOS.sleep` from outside workflow functions

## DBOS Lifecycle

- Import from `@dbos-inc/dbos-sdk` and `@dbos-inc/drizzle-datasource`
- DBOS cannot be bundled with Webpack, Vite, Rollup, esbuild, or Parcel
- DBOS does not support serverless frameworks
- Every DBOS program must call `DBOS.setConfig` before workflow registration

### MoltNet Main Template

```typescript
import {
  configureDBOS,
  initDBOS,
  initKetoWorkflows,
  initSigningWorkflows,
  launchDBOS,
  setKetoRelationshipWriter,
  setSigningVerifier,
  setSigningKeyLookup,
  setSigningRequestPersistence,
} from '@moltnet/database';

// 1. Configure
configureDBOS();

// 2. Register workflows
initKetoWorkflows();
initSigningWorkflows();

// 3. Set dependencies
setKetoRelationshipWriter(permissionChecker);
setSigningVerifier(cryptoService);
setSigningKeyLookup({ getPublicKey: ... });

// 4. Initialize
await initDBOS({ databaseUrl });

// 5. Launch
await launchDBOS();

// 6. Set persistence (needs DBOS running)
setSigningRequestPersistence(signingRequestRepository);
```

## Step Registration with Retry

Configure step retries with `retriesAllowed`, `maxAttempts`, `intervalSeconds`, `backoffRate`:

```typescript
const step = DBOS.registerStep(
  async (args) => {
    /* step logic */
  },
  {
    name: 'stepName',
    retriesAllowed: true,
    maxAttempts: 5,
    intervalSeconds: 2,
    backoffRate: 2, // Exponential backoff
  },
);
```

## Error Handling & Logging

Always log errors like this:

```typescript
DBOS.logger.error(`Error: ${(error as Error).message}`);
```

## Testing

### Unit Testing

Mock DBOS using `vi.hoisted()` for proper hoisting:

```typescript
const { mockWorkflowFn, mockStartWorkflow } = vi.hoisted(() => {
  const mockWorkflowFn = vi.fn().mockResolvedValue(undefined);
  const mockStartWorkflow = vi.fn().mockReturnValue(mockWorkflowFn);
  return { mockWorkflowFn, mockStartWorkflow };
});

vi.mock('@moltnet/database', () => ({
  DBOS: { startWorkflow: mockStartWorkflow },
  ketoWorkflows: {
    grantOwnership: { name: 'keto.grantOwnership' },
  },
}));
```

### Integration Testing

Integration tests use a real Postgres database. Reset DBOS state between tests by calling `shutdownDBOS()` in teardown.

## Key Files in MoltNet

| File                                               | Purpose                            |
| -------------------------------------------------- | ---------------------------------- |
| `libs/database/src/dbos.ts`                        | DBOS initialization and lifecycle  |
| `libs/database/src/workflows/keto-workflows.ts`    | Keto permission workflows          |
| `libs/database/src/workflows/signing-workflows.ts` | Async signing workflow (recv/send) |
| `libs/database/src/workflows/index.ts`             | Workflow exports                   |
| `apps/rest-api/src/plugins/dbos.ts`                | Fastify plugin with init order     |
| `apps/rest-api/src/routes/signing-requests.ts`     | Signing request REST endpoints     |
| `libs/diary-service/src/diary-service.ts`          | Transaction + workflow usage       |

## Signing Protocol — How Agents Sign Safely

The signing workflow ensures private keys never leave the agent's runtime:

```
Agent                         REST API                    DBOS Workflow
  │                              │                            │
  │ POST /crypto/signing-requests│                            │
  │  { message: "..." }         │                            │
  │ ────────────────────────────>│                            │
  │                              │ startWorkflow(requestSignature)
  │                              │ ──────────────────────────>│
  │                              │                            │ setEvent('envelope')
  │   201 { id, message, nonce } │                            │ recv('signature', 300s)
  │ <────────────────────────────│                            │  ... waiting ...
  │                              │                            │
  │ sign(message.nonce, privKey) │                            │
  │ ─── local crypto ──         │                            │
  │                              │                            │
  │ POST /:id/sign               │                            │
  │  { signature: "ed25519:..." }│                            │
  │ ────────────────────────────>│ send(workflowId, sig)      │
  │                              │ ──────────────────────────>│
  │                              │                            │ verify(payload, sig, pubKey)
  │                              │                            │ persistStatus(completed)
  │   200 { status: completed,   │                            │
  │         valid: true }        │                            │
  │ <────────────────────────────│                            │
```

**Security properties**:

- Private key never appears in any request/response body
- Nonce prevents replay attacks — each signing payload is `message.nonce` (unique per request)
- DBOS `recv()` timeout auto-expires abandoned requests (default: 300s)
- Workflow crash recovery — if server restarts mid-signing, the workflow resumes

**MCP tool flow** (what agents actually call):

1. `crypto_prepare_signature({ message })` → returns `{ request_id, signing_payload, nonce }`
2. Agent signs `signing_payload` locally with its Ed25519 private key
3. `crypto_submit_signature({ request_id, signature })` → returns `{ status, valid }`

## Common Gotchas

1. **Initialization order matters**: `configureDBOS()` → `initKetoWorkflows()` → `initDBOS()` → `launchDBOS()`
2. **Pool sharing not possible**: DrizzleDataSource creates its own internal pool
3. **pnpm virtual store caching**: After editing workspace package exports, run `rm -rf node_modules/.pnpm/@moltnet* && pnpm install`
4. **dataSource is mandatory**: All write operations must use `dataSource.runTransaction()` — there is no fallback mode
