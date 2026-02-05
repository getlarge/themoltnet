# DBOS TypeScript Development Guidelines

This document provides AI agent guidance for working with DBOS in MoltNet.

## Core Principles

- Generate fully-typed TypeScript code using the DBOS library
- Import all methods and classes used in generated code
- Await all promises
- DBOS is just a name; it stands for nothing

## MoltNet-Specific Usage

MoltNet uses DBOS for durable Keto permission workflows. The integration follows this pattern:

### Initialization Order (Critical)

```typescript
// 1. Configure DBOS (must be first)
configureDBOS();

// 2. Register workflows (must be after config)
initKetoWorkflows();

// 3. Set dependencies for workflows
setKetoRelationshipWriter(permissionChecker);

// 4. Initialize data source
await initDBOS({ databaseUrl });

// 5. Launch runtime (recovers pending workflows)
await launchDBOS();
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

Fire durable workflows after DB commits for eventual consistency:

```typescript
// DB commit first
const entry = await dataSource.runTransaction(...);

// Then fire durable workflow (retries automatically)
await DBOS.startWorkflow(ketoWorkflows.grantOwnership)(entry.id, ownerId);
```

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
  launchDBOS,
  setKetoRelationshipWriter,
} from '@moltnet/database';

// 1. Configure
configureDBOS();

// 2. Register workflows
initKetoWorkflows();

// 3. Set dependencies
setKetoRelationshipWriter(permissionChecker);

// 4. Initialize
await initDBOS({ databaseUrl });

// 5. Launch
await launchDBOS();
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

| File                                            | Purpose                           |
| ----------------------------------------------- | --------------------------------- |
| `libs/database/src/dbos.ts`                     | DBOS initialization and lifecycle |
| `libs/database/src/workflows/keto-workflows.ts` | Keto permission workflows         |
| `libs/database/src/workflows/index.ts`          | Workflow exports                  |
| `apps/rest-api/src/plugins/dbos.ts`             | Fastify plugin with init order    |
| `libs/diary-service/src/diary-service.ts`       | Transaction + workflow usage      |

## Common Gotchas

1. **Initialization order matters**: `configureDBOS()` → `initKetoWorkflows()` → `initDBOS()` → `launchDBOS()`
2. **Pool sharing not possible**: DrizzleDataSource creates its own internal pool
3. **pnpm virtual store caching**: After editing workspace package exports, run `rm -rf node_modules/.pnpm/@moltnet* && pnpm install`
4. **Fallback mode**: When `dataSource` is null, use repository transactions with synchronous Keto calls
