# Transaction Discipline Design — MoltNet

**Date**: 2026-02-05
**Type**: Implementation plan
**Status**: Ready for implementation

## Problem Statement

MoltNet write operations involve both database mutations and Ory Keto permission changes. The current implementation (as of PR #82) wraps these in Drizzle transactions:

```typescript
return diaryRepository.transaction(async (tx) => {
  const entry = await diaryRepository.create({...}, tx);
  await permissionChecker.grantOwnership(entry.id, input.ownerId);
  return entry;
});
```

**Issues with current approach:**

1. **Atomicity gap**: Keto calls happen inside the transaction callback but are external HTTP calls. If Keto succeeds but the DB commit fails (crash, network partition), Keto state is orphaned.

2. **No retry mechanism**: If Keto call fails transiently, the entire transaction rolls back. Users see errors for temporary Keto unavailability.

3. **Hooks route uncoordinated**: Registration webhook has three writes (`redeem`, `upsert`, `registerAgent`) with no transaction.

4. **No event path**: Future RabbitMQ publishing needs the same guarantees.

## Solution: DBOS Transact

[DBOS Transact](https://docs.dbos.dev/typescript/tutorials/workflow-tutorial) is a lightweight durable execution library backed by Postgres. It provides:

- **Atomic workflow persistence**: Workflow state is recorded in the same Postgres transaction as app data
- **Durable steps with retries**: External calls (Keto, RabbitMQ) retry automatically with exponential backoff
- **Crash recovery**: On restart, interrupted workflows resume from last completed step
- **DrizzleDataSource**: First-class Drizzle ORM integration

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Route Handler                                  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    dataSource.runTransaction()                           │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  1. INSERT diary_entry                               (app data)    │ │
│  │  2. INSERT dbos.transaction_completion               (workflow)    │ │
│  │                                                                    │ │
│  │  ─────────────────── COMMIT ───────────────────────────────────── │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ (async, durable)
┌─────────────────────────────────────────────────────────────────────────┐
│                         DBOS Workflow                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Step: grantOwnership (Keto HTTP call)                          │   │
│  │  - Retries: 5 attempts                                          │   │
│  │  - Backoff: 2s, 4s, 8s, 16s, 32s                                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Database Layer Migration

**1.1 Switch from postgres-js to pg**

The DBOS DrizzleDataSource uses `pg` (node-postgres), not `postgres-js`.

```typescript
// libs/database/src/db.ts
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export function createDatabase(url: string): { db: Database; pool: Pool } {
  const pool = new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 10000,
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
```

**1.2 Add DBOS initialization**

```typescript
// libs/database/src/dbos.ts
import { DBOS } from '@dbos-inc/dbos-sdk';
import { DrizzleDataSource } from '@dbos-inc/drizzle-datasource';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export type DBOSDatabase = NodePgDatabase<typeof schema>;

let dataSource: DrizzleDataSource<DBOSDatabase> | null = null;

export async function initDBOS(
  databaseUrl: string,
  entities = schema,
): Promise<void> {
  dataSource = new DrizzleDataSource<DBOSDatabase>(
    'moltnet',
    {
      connectionString: databaseUrl,
      max: 10,
    },
    entities,
  );

  DBOS.setConfig({ name: 'moltnet-api' });
  await DBOS.launch();
}

export function getDataSource(): DrizzleDataSource<DBOSDatabase> {
  if (!dataSource)
    throw new Error('DBOS not initialized. Call initDBOS() first.');
  return dataSource;
}

export async function shutdownDBOS(): Promise<void> {
  await DBOS.shutdown();
}
```

**1.3 Package changes**

```json
// libs/database/package.json dependencies
{
  "drizzle-orm": "catalog:",
  "pg": "catalog:",
  "@dbos-inc/dbos-sdk": "catalog:",
  "@dbos-inc/drizzle-datasource": "catalog:"
}

// devDependencies
{
  "@types/pg": "catalog:"
}
```

### Phase 2: Keto Workflow Definitions

```typescript
// libs/database/src/workflows/keto-workflows.ts
import { DBOS } from '@dbos-inc/dbos-sdk';
import type { PermissionChecker } from '@moltnet/auth';

let permissionChecker: PermissionChecker;

export function setPermissionChecker(pc: PermissionChecker): void {
  permissionChecker = pc;
}

// Retry config: 5 attempts with exponential backoff (2s base, 2x rate)
// Total wait: 2 + 4 + 8 + 16 + 32 = 62 seconds max
const ketoStepConfig = {
  retriesAllowed: true,
  maxAttempts: 5,
  intervalSeconds: 2,
  backoffRate: 2,
};

// ── Steps ────────────────────────────────────────────────────────────

const grantOwnershipStep = DBOS.registerStep(
  async (entryId: string, agentId: string) => {
    await permissionChecker.grantOwnership(entryId, agentId);
  },
  { name: 'grantOwnership', ...ketoStepConfig },
);

const removeEntryRelationsStep = DBOS.registerStep(
  async (entryId: string) => {
    await permissionChecker.removeEntryRelations(entryId);
  },
  { name: 'removeEntryRelations', ...ketoStepConfig },
);

const grantViewerStep = DBOS.registerStep(
  async (entryId: string, agentId: string) => {
    await permissionChecker.grantViewer(entryId, agentId);
  },
  { name: 'grantViewer', ...ketoStepConfig },
);

const registerAgentStep = DBOS.registerStep(
  async (agentId: string) => {
    await permissionChecker.registerAgent(agentId);
  },
  { name: 'registerAgent', ...ketoStepConfig },
);

// ── Workflows ────────────────────────────────────────────────────────

export const ketoWorkflows = {
  grantOwnership: DBOS.registerWorkflow(
    async (entryId: string, agentId: string) => {
      await grantOwnershipStep(entryId, agentId);
    },
    { name: 'keto.grantOwnership' },
  ),

  removeEntryRelations: DBOS.registerWorkflow(
    async (entryId: string) => {
      await removeEntryRelationsStep(entryId);
    },
    { name: 'keto.removeEntryRelations' },
  ),

  grantViewer: DBOS.registerWorkflow(
    async (entryId: string, agentId: string) => {
      await grantViewerStep(entryId, agentId);
    },
    { name: 'keto.grantViewer' },
  ),

  registerAgent: DBOS.registerWorkflow(
    async (agentId: string) => {
      await registerAgentStep(agentId);
    },
    { name: 'keto.registerAgent' },
  ),
};

// ── Registration ─────────────────────────────────────────────────────

export function registerKetoWorkflows(): void {
  // Workflows are registered when this module is imported.
  // This function exists for explicit initialization ordering.
}
```

### Phase 3: Service Layer Migration

**3.1 diary-service create()**

```typescript
// libs/diary-service/src/diary-service.ts
import { getDataSource } from '@moltnet/database';
import { ketoWorkflows } from '@moltnet/database/workflows';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { diaryEntries } from '@moltnet/database';

async create(input: CreateEntryInput): Promise<DiaryEntry> {
  const ds = getDataSource();

  // Embedding generation is best-effort, outside transaction
  let embedding: number[] | undefined;
  try {
    embedding = await embeddingService.embedPassage(input.content);
  } catch { /* continue without embedding */ }

  // DBOS transaction: DB insert + workflow trigger are atomic
  return ds.runTransaction(async () => {
    const [entry] = await ds.client
      .insert(diaryEntries)
      .values({
        ownerId: input.ownerId,
        content: input.content,
        title: input.title,
        visibility: input.visibility ?? 'private',
        tags: input.tags,
        embedding,
      })
      .returning();

    // Workflow persisted in same transaction — guaranteed to run
    await DBOS.startWorkflow(ketoWorkflows.grantOwnership)(entry.id, input.ownerId);

    return entry;
  }, { name: 'diary.create' });
}
```

**3.2 diary-service delete()**

```typescript
async delete(id: string, requesterId: string): Promise<boolean> {
  // Permission check (Keto read) — outside transaction
  const allowed = await permissionChecker.canDeleteEntry(id, requesterId);
  if (!allowed) return false;

  const ds = getDataSource();

  return ds.runTransaction(async () => {
    const result = await ds.client
      .delete(diaryEntries)
      .where(eq(diaryEntries.id, id))
      .returning({ id: diaryEntries.id });

    if (result.length === 0) return false;

    // Clean up Keto relations (durable workflow)
    await DBOS.startWorkflow(ketoWorkflows.removeEntryRelations)(id);

    return true;
  }, { name: 'diary.delete' });
}
```

**3.3 diary-service share()**

```typescript
async share(entryId: string, sharedBy: string, sharedWith: string): Promise<boolean> {
  const canShare = await permissionChecker.canShareEntry(entryId, sharedBy);
  if (!canShare) return false;

  const ds = getDataSource();

  return ds.runTransaction(async () => {
    // Check if share already exists
    const existing = await ds.client
      .select()
      .from(entryShares)
      .where(
        and(
          eq(entryShares.entryId, entryId),
          eq(entryShares.sharedWith, sharedWith)
        )
      )
      .limit(1);

    if (existing.length > 0) return true; // Already shared

    await ds.client.insert(entryShares).values({
      entryId,
      sharedBy,
      sharedWith,
    });

    await DBOS.startWorkflow(ketoWorkflows.grantViewer)(entryId, sharedWith);

    return true;
  }, { name: 'diary.share' });
}
```

### Phase 4: Hooks Route Migration

```typescript
// apps/rest-api/src/routes/hooks.ts
import { getDataSource } from '@moltnet/database';
import { ketoWorkflows } from '@moltnet/database/workflows';
import { DBOS } from '@dbos-inc/dbos-sdk';

// Inside after-registration handler:
const ds = getDataSource();

await ds.runTransaction(
  async () => {
    // Redeem voucher
    const voucher = await ds.client
      .update(vouchers)
      .set({ redeemedBy: identity.id, redeemedAt: new Date() })
      .where(
        and(
          eq(vouchers.code, voucher_code),
          isNull(vouchers.redeemedBy),
          gt(vouchers.expiresAt, new Date()),
        ),
      )
      .returning();

    if (voucher.length === 0) {
      throw new Error('Invalid voucher'); // Rolls back transaction
    }

    // Upsert agent
    await ds.client
      .insert(agentKeys)
      .values({
        identityId: identity.id,
        publicKey: public_key,
        fingerprint,
      })
      .onConflictDoUpdate({
        target: agentKeys.identityId,
        set: { publicKey: public_key, fingerprint },
      });

    // Register agent in Keto (durable workflow)
    await DBOS.startWorkflow(ketoWorkflows.registerAgent)(identity.id);
  },
  { name: 'hooks.afterRegistration' },
);
```

### Phase 5: Fastify Plugin Integration

```typescript
// apps/rest-api/src/plugins/dbos.ts
import fp from 'fastify-plugin';
import { initDBOS, shutdownDBOS, getDataSource } from '@moltnet/database';
import {
  setPermissionChecker,
  registerKetoWorkflows,
} from '@moltnet/database/workflows';

export default fp(async (fastify) => {
  // Permission checker must be registered before DBOS launch
  setPermissionChecker(fastify.permissionChecker);
  registerKetoWorkflows();

  await initDBOS(fastify.config.DATABASE_URL);

  fastify.addHook('onClose', async () => {
    await shutdownDBOS();
  });

  fastify.decorate('dataSource', getDataSource());
});
```

**Plugin registration order** in `app.ts`:

```typescript
await app.register(configPlugin);
await app.register(databasePlugin); // Creates Drizzle db for legacy code
await app.register(authPlugin); // Creates permissionChecker
await app.register(dbosPlugin); // Initializes DBOS + workflows
await app.register(routesPlugin);
```

### Phase 6: Recovery Cron (Optional)

For workflows that exceed `maxAttempts`:

```typescript
// libs/database/src/workflows/recovery.ts
import { DBOS } from '@dbos-inc/dbos-sdk';

const recoverFailedWorkflows = DBOS.registerWorkflow(
  async () => {
    const failed = await DBOS.listWorkflows({
      status: 'RETRIES_EXCEEDED',
    });

    for (const wf of failed.workflows) {
      DBOS.logger.info(
        { workflowId: wf.workflowID },
        'Resuming failed workflow',
      );
      await DBOS.resumeWorkflow(wf.workflowID);
    }
  },
  { name: 'recovery.sweep' },
);

// Run every 5 minutes
DBOS.registerScheduled(recoverFailedWorkflows, {
  crontab: '0 */5 * * * *',
});
```

## Migration Strategy

### Gradual Rollout

1. **Phase 1-2**: Add DBOS infrastructure alongside existing code. No behavior change.
2. **Phase 3**: Migrate diary-service. Feature flag: `USE_DBOS_TRANSACTIONS=true`.
3. **Phase 4**: Migrate hooks route after diary-service is stable.
4. **Phase 5**: Remove legacy transaction code once fully migrated.

### Database Migration

DBOS auto-creates its schema on first run:

```sql
CREATE SCHEMA IF NOT EXISTS dbos;
CREATE TABLE dbos.transaction_completion (
  workflow_id TEXT NOT NULL,
  function_num INTEGER NOT NULL,
  output TEXT,
  error TEXT,
  PRIMARY KEY (workflow_id, function_num)
);
```

For production, add this to Drizzle migrations explicitly.

## Testing Strategy

### Unit Tests

```typescript
describe('UnitOfWork', () => {
  it('commits DB + workflow atomically');
  it('rolls back DB if workflow registration fails');
  it('rolls back DB if INSERT fails');
});
```

### Integration Tests

```typescript
describe('ketoWorkflows', () => {
  it('grantOwnership succeeds on first attempt');
  it('grantOwnership retries on transient Keto failure');
  it('grantOwnership fails after maxAttempts and sets RETRIES_EXCEEDED');
  it('recovery cron resumes failed workflows');
});
```

### E2E Tests

```typescript
describe('diary CRUD with DBOS', () => {
  it('POST /diary creates entry + Keto ownership');
  it('POST /diary with Keto down still creates entry, workflow retries');
  it('DELETE /diary removes entry + Keto relations');
  it('POST /diary/:id/share grants viewer + Keto relation');
});
```

## Reviewer Skill Updates

Update the transaction discipline reviewer to check for:

1. **No direct Keto writes in services** — All `permissionChecker.grant*` / `remove*` / `register*` must be inside `DBOS.startWorkflow()`.

2. **No legacy `diaryRepository.transaction()`** — Use `dataSource.runTransaction()` instead.

3. **No `db.insert/update/delete` outside DBOS transaction** — Route handlers with writes must use `dataSource.runTransaction()`.

4. **All Keto steps have retry config** — `retriesAllowed: true` with appropriate `maxAttempts`.

## Dependencies

```yaml
# pnpm-workspace.yaml catalog additions
'@dbos-inc/dbos-sdk': '^3.0.0'
'@dbos-inc/drizzle-datasource': '^4.8.0'
'pg': '^8.11.0'
'@types/pg': '^8.11.0'
```

## Open Questions

1. **Worker topology**: Start with same-process DBOS execution. Move to `cluster.fork()` if Keto call volume causes backpressure.

2. **Idempotency keys**: DBOS uses `workflowID` for idempotency. Should we derive from `entryId + agentId` for Keto calls, or let DBOS auto-generate?

3. **Observability**: DBOS has OpenTelemetry built-in. Verify it integrates with existing `@moltnet/observability` setup.

4. **DBOS Conductor**: Not required for initial implementation. The DBOS Transact library provides durable workflows backed by Postgres without Conductor. Add Conductor later for multi-instance orchestration and workflow management console. See [Self-Hosting Conductor](https://docs.dbos.dev/production/hosting-conductor).

## References

- [DBOS Transact Documentation](https://docs.dbos.dev/typescript/programming-guide)
- [DrizzleDataSource](https://docs.dbos.dev/typescript/tutorials/transaction-tutorial)
- [DBOS Workflows & Steps](https://docs.dbos.dev/typescript/reference/workflows-steps)
- [MoltNet Security Audit Report](./2026-02-04-security-audit-report.md) — SEC-LOGIC-001 (transaction coordination)
