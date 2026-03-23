# Pack GC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Garbage collect expired non-pinned context packs via a scheduled DBOS workflow, and expose pin/unpin + expiry update via REST + MCP.

**Architecture:** A DBOS workflow runs on a configurable cron, queries expired packs, deletes them in a transaction, and batch-cleans Keto relationships. A new `PATCH /packs/:id` endpoint lets agents pin/unpin packs and extend expiry. The MCP server gets a matching `packs_update` tool.

**Tech Stack:** TypeScript, Fastify, DBOS (workflows/steps/transactions), Drizzle ORM, Ory Keto, TypeBox, Vitest

**Spec:** `docs/superpowers/specs/2026-03-22-pack-gc-design.md`

---

## File Map

| File                                                                | Action | Responsibility                                                       |
| ------------------------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| `env.public`                                                        | Modify | Add `PACK_GC_COMPILE_TTL_DAYS`, `PACK_GC_CRON`, `PACK_GC_BATCH_SIZE` |
| `libs/auth/src/relationship-writer.ts`                              | Modify | Add `removePackRelationsBatch()`                                     |
| `libs/auth/__tests__/relationship-writer.test.ts`                   | Modify | Test batch removal                                                   |
| `libs/database/src/repositories/context-pack.repository.ts`         | Modify | Add `updateExpiry()`                                                 |
| `libs/database/src/index.ts`                                        | Check  | Verify `ContextPackRepository` type is re-exported                   |
| `apps/rest-api/src/workflows/maintenance.ts`                        | Modify | Add pack GC workflow + steps + scheduler                             |
| `apps/rest-api/src/workflows/index.ts`                              | Modify | Re-export new types                                                  |
| `apps/rest-api/src/bootstrap.ts`                                    | Modify | Wire pack GC deps in `afterLaunch`                                   |
| `apps/rest-api/src/workflows/__tests__/maintenance-pack-gc.test.ts` | Create | GC workflow tests                                                    |
| `apps/rest-api/src/workflows/context-distill-workflows.ts`          | Modify | Use `PACK_GC_COMPILE_TTL_DAYS` env var                               |
| `apps/rest-api/src/routes/packs.ts`                                 | Modify | Add `PATCH /packs/:id` route                                         |
| `apps/rest-api/src/schemas.ts`                                      | Modify | Add `PackUpdateBodySchema` + response type                           |
| `apps/rest-api/src/routes/__tests__/packs-update.test.ts`           | Create | PATCH endpoint tests                                                 |
| `apps/mcp-server/src/schemas.ts`                                    | Modify | Add `PackUpdateSchema` + type                                        |
| `apps/mcp-server/src/pack-tools.ts`                                 | Modify | Add `packs_update` handler + registration                            |

---

### Task 1: Add env vars and TTL configuration

**Files:**

- Modify: `env.public`
- Modify: `apps/rest-api/src/workflows/context-distill-workflows.ts:476-478`
- Modify: `apps/rest-api/src/routes/packs.ts:381-383`

- [ ] **Step 1: Add env vars to `env.public`**

Append to `env.public`:

```
# ── Pack GC ───────────────────────────────────────────────────
PACK_GC_COMPILE_TTL_DAYS="7"
PACK_GC_CRON="0 * * * *"
PACK_GC_BATCH_SIZE="100"
```

- [ ] **Step 2: Replace hardcoded TTL in compile workflow**

In `apps/rest-api/src/workflows/context-distill-workflows.ts` line 478, replace:

```typescript
expiresAt: new Date(createdAtDate.getTime() + 7 * 24 * 60 * 60 * 1000),
```

with:

```typescript
expiresAt: new Date(
  createdAtDate.getTime() +
    (parseInt(process.env['PACK_GC_COMPILE_TTL_DAYS'] ?? '7', 10)) *
      24 * 60 * 60 * 1000,
),
```

- [ ] **Step 3: Replace hardcoded TTL in custom pack route**

In `apps/rest-api/src/routes/packs.ts` line 383, replace:

```typescript
: new Date(createdAtDate.getTime() + 7 * 24 * 60 * 60 * 1000);
```

with:

```typescript
: new Date(
    createdAtDate.getTime() +
      (parseInt(process.env['PACK_GC_COMPILE_TTL_DAYS'] ?? '7', 10)) *
        24 * 60 * 60 * 1000,
  );
```

- [ ] **Step 4: Verify typecheck passes**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-pack-gc && pnpm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add env.public apps/rest-api/src/workflows/context-distill-workflows.ts apps/rest-api/src/routes/packs.ts
git commit -m "feat(pack-gc): add TTL env vars and replace hardcoded 7-day expiry"
```

---

### Task 2: Add `removePackRelationsBatch` to RelationshipWriter

**Files:**

- Modify: `libs/auth/src/relationship-writer.ts`
- Modify: `libs/auth/__tests__/relationship-writer.test.ts`

- [ ] **Step 1: Write failing test for batch removal**

Add to `libs/auth/__tests__/relationship-writer.test.ts`, inside a new `describe('removePackRelationsBatch')` block after the existing `removeEntryRelations` describe:

```typescript
describe('removePackRelationsBatch', () => {
  const PACK_ID_1 = 'aaaa0000-0000-0000-0000-000000000001';
  const PACK_ID_2 = 'aaaa0000-0000-0000-0000-000000000002';
  const DIARY_ID_1 = 'bbbb0000-0000-0000-0000-000000000001';
  const DIARY_ID_2 = 'bbbb0000-0000-0000-0000-000000000002';

  it('sends single patchRelationships call with delete actions', async () => {
    mockRelationshipApi.patchRelationships.mockResolvedValue(undefined);

    await writer.removePackRelationsBatch([
      { id: PACK_ID_1, diaryId: DIARY_ID_1 },
      { id: PACK_ID_2, diaryId: DIARY_ID_2 },
    ]);

    expect(mockRelationshipApi.patchRelationships).toHaveBeenCalledOnce();
    expect(mockRelationshipApi.patchRelationships).toHaveBeenCalledWith({
      relationshipPatch: [
        {
          action: 'delete',
          relation_tuple: {
            namespace: 'ContextPack',
            object: PACK_ID_1,
            relation: 'parent',
            subject_set: {
              namespace: 'Diary',
              object: DIARY_ID_1,
              relation: '',
            },
          },
        },
        {
          action: 'delete',
          relation_tuple: {
            namespace: 'ContextPack',
            object: PACK_ID_2,
            relation: 'parent',
            subject_set: {
              namespace: 'Diary',
              object: DIARY_ID_2,
              relation: '',
            },
          },
        },
      ],
    });
  });

  it('is a no-op for empty array', async () => {
    await writer.removePackRelationsBatch([]);

    expect(mockRelationshipApi.patchRelationships).not.toHaveBeenCalled();
  });
});
```

Also add `patchRelationships` to the mock:

In `createMockRelationshipApi`, add:

```typescript
patchRelationships: vi.fn(),
```

And in the `MockRelationshipApi` interface, add:

```typescript
patchRelationships: ReturnType<typeof vi.fn>;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-pack-gc && pnpm --filter @moltnet/auth run test -- --run`
Expected: FAIL — `writer.removePackRelationsBatch is not a function`

- [ ] **Step 3: Implement `removePackRelationsBatch`**

In `libs/auth/src/relationship-writer.ts`:

Add to the `RelationshipWriter` interface (after `removePackRelations`):

```typescript
removePackRelationsBatch(
  packs: Array<{ id: string; diaryId: string }>,
): Promise<void>;
```

Add to the implementation object (after `removePackRelations`):

```typescript
async removePackRelationsBatch(
  packs: Array<{ id: string; diaryId: string }>,
): Promise<void> {
  if (packs.length === 0) return;

  await relationshipApi.patchRelationships({
    relationshipPatch: packs.map((pack) => ({
      action: 'delete' as const,
      relation_tuple: {
        namespace: KetoNamespace.ContextPack,
        object: pack.id,
        relation: ContextPackRelation.Parent,
        subject_set: {
          namespace: KetoNamespace.Diary,
          object: pack.diaryId,
          relation: '',
        },
      },
    })),
  });
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-pack-gc && pnpm --filter @moltnet/auth run test -- --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add libs/auth/src/relationship-writer.ts libs/auth/__tests__/relationship-writer.test.ts
git commit -m "feat(auth): add removePackRelationsBatch for bulk Keto cleanup"
```

---

### Task 3: Add `updateExpiry` to context pack repository

**Files:**

- Modify: `libs/database/src/repositories/context-pack.repository.ts`

- [ ] **Step 1: Add `updateExpiry` method**

In `libs/database/src/repositories/context-pack.repository.ts`, add after the `unpin` method (after line 316):

```typescript
async updateExpiry(
  id: string,
  expiresAt: Date,
): Promise<ContextPack | null> {
  const [row] = await getExecutor(db)
    .update(contextPacks)
    .set({ expiresAt })
    .where(eq(contextPacks.id, id))
    .returning();

  return row ?? null;
},
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-pack-gc && pnpm --filter @moltnet/database run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add libs/database/src/repositories/context-pack.repository.ts
git commit -m "feat(database): add updateExpiry method to context pack repository"
```

---

### Task 4: Pack GC DBOS workflow

**Files:**

- Modify: `apps/rest-api/src/workflows/maintenance.ts`
- Modify: `apps/rest-api/src/workflows/index.ts`
- Modify: `apps/rest-api/src/bootstrap.ts:260-262`
- Create: `apps/rest-api/src/workflows/__tests__/maintenance-pack-gc.test.ts`

- [ ] **Step 1: Write failing tests for the GC workflow**

Create `apps/rest-api/src/workflows/__tests__/maintenance-pack-gc.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContextPackRepository, DataSource } from '@moltnet/database';
import type { RelationshipWriter } from '@moltnet/auth';

// Mock DBOS before importing maintenance module
vi.mock('@moltnet/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@moltnet/database')>();
  return {
    ...original,
    DBOS: {
      registerScheduled: vi.fn(),
      registerStep: vi.fn((fn: Function) => fn),
      registerWorkflow: vi.fn((fn: Function) => fn),
      startWorkflow: vi.fn(),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    },
  };
});

function createMockDeps() {
  const contextPackRepository = {
    listExpiredUnpinned: vi.fn(),
    deleteMany: vi.fn(),
  } as unknown as ContextPackRepository & {
    listExpiredUnpinned: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };

  const dataSource = {
    runTransaction: vi.fn(async (fn: Function) => fn()),
  } as unknown as DataSource & {
    runTransaction: ReturnType<typeof vi.fn>;
  };

  const relationshipWriter = {
    removePackRelationsBatch: vi.fn(),
  } as unknown as RelationshipWriter & {
    removePackRelationsBatch: ReturnType<typeof vi.fn>;
  };

  return { contextPackRepository, dataSource, relationshipWriter };
}

describe('maintenance.packGc', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let packGcWorkflow: (input: {
    batchSize: number;
  }) => Promise<{ deleted: number; batchFull: boolean }>;

  beforeEach(async () => {
    vi.resetModules();
    deps = createMockDeps();

    const { DBOS } = await import('@moltnet/database');
    const { initMaintenanceWorkflows, setMaintenanceDeps } =
      await import('../maintenance.js');

    initMaintenanceWorkflows();
    setMaintenanceDeps({
      nonceRepository: { cleanup: vi.fn() } as any,
      contextPackRepository: deps.contextPackRepository,
      dataSource: deps.dataSource,
      relationshipWriter: deps.relationshipWriter,
    });

    // Extract the workflow function from registerWorkflow call
    const registerWorkflowCalls = vi.mocked(DBOS.registerWorkflow).mock.calls;
    const packGcCall = registerWorkflowCalls.find(
      (call) => call[1]?.name === 'maintenance.packGc',
    );
    expect(packGcCall).toBeDefined();
    packGcWorkflow = packGcCall![0] as typeof packGcWorkflow;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deletes expired packs and cleans up Keto relations', async () => {
    const expiredPacks = [
      {
        id: 'pack-1',
        diaryId: 'diary-1',
        pinned: false,
        expiresAt: new Date('2020-01-01'),
      },
      {
        id: 'pack-2',
        diaryId: 'diary-2',
        pinned: false,
        expiresAt: new Date('2020-01-02'),
      },
      {
        id: 'pack-3',
        diaryId: 'diary-1',
        pinned: false,
        expiresAt: new Date('2020-01-03'),
      },
    ];
    deps.contextPackRepository.listExpiredUnpinned.mockResolvedValue(
      expiredPacks,
    );
    deps.contextPackRepository.deleteMany.mockResolvedValue(3);
    deps.relationshipWriter.removePackRelationsBatch.mockResolvedValue(
      undefined,
    );

    const result = await packGcWorkflow({ batchSize: 100 });

    expect(result).toEqual({ deleted: 3, batchFull: false });
    expect(deps.contextPackRepository.deleteMany).toHaveBeenCalledWith([
      'pack-1',
      'pack-2',
      'pack-3',
    ]);
    expect(
      deps.relationshipWriter.removePackRelationsBatch,
    ).toHaveBeenCalledWith([
      { id: 'pack-1', diaryId: 'diary-1' },
      { id: 'pack-2', diaryId: 'diary-2' },
      { id: 'pack-3', diaryId: 'diary-1' },
    ]);
  });

  it('returns no-op when no expired packs exist', async () => {
    deps.contextPackRepository.listExpiredUnpinned.mockResolvedValue([]);

    const result = await packGcWorkflow({ batchSize: 100 });

    expect(result).toEqual({ deleted: 0, batchFull: false });
    expect(deps.contextPackRepository.deleteMany).not.toHaveBeenCalled();
    expect(
      deps.relationshipWriter.removePackRelationsBatch,
    ).not.toHaveBeenCalled();
  });

  it('reports batchFull when batch size is reached', async () => {
    const expiredPacks = Array.from({ length: 50 }, (_, i) => ({
      id: `pack-${i}`,
      diaryId: `diary-${i}`,
      pinned: false,
      expiresAt: new Date('2020-01-01'),
    }));
    deps.contextPackRepository.listExpiredUnpinned.mockResolvedValue(
      expiredPacks,
    );
    deps.contextPackRepository.deleteMany.mockResolvedValue(50);
    deps.relationshipWriter.removePackRelationsBatch.mockResolvedValue(
      undefined,
    );

    const result = await packGcWorkflow({ batchSize: 50 });

    expect(result).toEqual({ deleted: 50, batchFull: true });
  });

  it('completes even if Keto cleanup fails', async () => {
    const expiredPacks = [
      {
        id: 'pack-1',
        diaryId: 'diary-1',
        pinned: false,
        expiresAt: new Date('2020-01-01'),
      },
    ];
    deps.contextPackRepository.listExpiredUnpinned.mockResolvedValue(
      expiredPacks,
    );
    deps.contextPackRepository.deleteMany.mockResolvedValue(1);
    deps.relationshipWriter.removePackRelationsBatch.mockRejectedValue(
      new Error('Keto unavailable'),
    );

    const result = await packGcWorkflow({ batchSize: 100 });

    expect(result).toEqual({ deleted: 1, batchFull: false });
    expect(deps.contextPackRepository.deleteMany).toHaveBeenCalled();
  });

  it('respects configured batch size', async () => {
    deps.contextPackRepository.listExpiredUnpinned.mockResolvedValue([]);

    await packGcWorkflow({ batchSize: 25 });

    expect(deps.contextPackRepository.listExpiredUnpinned).toHaveBeenCalledWith(
      expect.any(Date),
      25,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-pack-gc && pnpm --filter @moltnet/rest-api run test -- --run apps/rest-api/src/workflows/__tests__/maintenance-pack-gc.test.ts`
Expected: FAIL — workflow not found / deps shape mismatch

- [ ] **Step 3: Implement the GC workflow in maintenance.ts**

Replace the entire `apps/rest-api/src/workflows/maintenance.ts` with:

```typescript
/**
 * Maintenance Workflows
 *
 * Scheduled DBOS workflows for routine housekeeping tasks.
 *
 * ## Initialization Order
 *
 * 1. Call `initMaintenanceWorkflows()` in `registerWorkflows` (after configureDBOS).
 * 2. Call `setMaintenanceDeps()` in `afterLaunch` (once repositories are available).
 */

import type { RelationshipWriter } from '@moltnet/auth';
import {
  type ContextPackRepository,
  type DataSource,
  DBOS,
  type NonceRepository,
} from '@moltnet/database';

// ── Types ──────────────────────────────────────────────────────

export interface MaintenanceDeps {
  nonceRepository: NonceRepository;
  contextPackRepository: ContextPackRepository;
  dataSource: DataSource;
  relationshipWriter: RelationshipWriter;
}

// ── Dependency Injection ───────────────────────────────────────

let _deps: MaintenanceDeps | null = null;

function getDeps(): MaintenanceDeps {
  if (!_deps) throw new Error('Maintenance deps not set');
  return _deps;
}

export function setMaintenanceDeps(deps: MaintenanceDeps): void {
  _deps = deps;
}

// ── Lazy Registration ──────────────────────────────────────────

let _initialized = false;

/**
 * Register all maintenance workflows with DBOS.
 *
 * Must be called after configureDBOS() and before launchDBOS().
 * Idempotent — safe to call multiple times.
 */
export function initMaintenanceWorkflows(): void {
  if (_initialized) return;
  _initialized = true;

  // ── Nonce Cleanup ────────────────────────────────────────────
  DBOS.registerScheduled(
    async (_scheduledTime: Date, _actualTime: Date): Promise<void> => {
      const { nonceRepository } = getDeps();
      await nonceRepository.cleanup();
      DBOS.logger.info('maintenance: nonce cleanup complete');
    },
    { name: 'maintenance.nonceCleanup', crontab: '0 0 * * *' },
  );

  // ── Pack GC ──────────────────────────────────────────────────

  const listExpiredStep = DBOS.registerStep(
    async (now: Date, batchSize: number) => {
      const { contextPackRepository } = getDeps();
      return contextPackRepository.listExpiredUnpinned(now, batchSize);
    },
    { name: 'maintenance.packGc.listExpired' },
  );

  const ketoCleanupStep = DBOS.registerStep(
    async (packs: Array<{ id: string; diaryId: string }>) => {
      const { relationshipWriter } = getDeps();
      await relationshipWriter.removePackRelationsBatch(packs);
    },
    {
      name: 'maintenance.packGc.ketoCleanup',
      retriesAllowed: true,
      maxAttempts: 3,
      backoffBaseMs: 1000,
    },
  );

  const packGcWorkflow = DBOS.registerWorkflow(
    async (input: { batchSize: number }) => {
      const expiredPacks = await listExpiredStep(new Date(), input.batchSize);

      if (expiredPacks.length === 0) {
        DBOS.logger.info('maintenance: pack GC — no expired packs');
        return { deleted: 0, batchFull: false };
      }

      const ids = expiredPacks.map((p) => p.id);
      const packRefs = expiredPacks.map((p) => ({
        id: p.id,
        diaryId: p.diaryId,
      }));

      // Atomic deletion — FK cascade removes context_pack_entries
      const { dataSource, contextPackRepository } = getDeps();
      const deleted = await dataSource.runTransaction(
        async () => contextPackRepository.deleteMany(ids),
        { name: 'maintenance.packGc.tx.delete' },
      );

      // Best-effort Keto cleanup — orphaned tuples are harmless
      try {
        await ketoCleanupStep(packRefs);
      } catch (error) {
        DBOS.logger.warn(
          { err: error, packIds: ids },
          'maintenance: pack GC — Keto cleanup failed (orphaned tuples are harmless)',
        );
      }

      const batchFull = expiredPacks.length >= input.batchSize;
      DBOS.logger.info({ deleted, batchFull }, 'maintenance: pack GC complete');

      return { deleted, batchFull };
    },
    { name: 'maintenance.packGc' },
  );

  const cron = process.env['PACK_GC_CRON'] ?? '0 * * * *';
  const batchSize = parseInt(process.env['PACK_GC_BATCH_SIZE'] ?? '100', 10);

  DBOS.registerScheduled(
    async (_scheduledTime: Date, _actualTime: Date): Promise<void> => {
      await DBOS.startWorkflow(packGcWorkflow, { batchSize });
    },
    { name: 'maintenance.packGcScheduler', crontab: cron },
  );
}
```

- [ ] **Step 4: Update `apps/rest-api/src/workflows/index.ts`**

The re-export of `MaintenanceDeps` and `setMaintenanceDeps` should already work since the interface changed in-place. Verify that the existing re-exports at lines 25-28 still match:

```typescript
export {
  initMaintenanceWorkflows,
  type MaintenanceDeps,
  setMaintenanceDeps,
} from './maintenance.js';
```

No change needed if this already exists.

- [ ] **Step 5: Update `apps/rest-api/src/bootstrap.ts` wiring**

In `apps/rest-api/src/bootstrap.ts`, replace line 261:

```typescript
setMaintenanceDeps({ nonceRepository });
```

with:

```typescript
setMaintenanceDeps({
  nonceRepository,
  contextPackRepository,
  dataSource: getDataSource(),
  relationshipWriter,
});
```

`contextPackRepository`, `getDataSource`, and `relationshipWriter` are already in scope at that point in the bootstrap file (they're declared earlier in the same `afterLaunch` callbacks).

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-pack-gc && pnpm --filter @moltnet/rest-api run test -- --run apps/rest-api/src/workflows/__tests__/maintenance-pack-gc.test.ts`
Expected: PASS

- [ ] **Step 7: Run typecheck**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-pack-gc && pnpm run typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/rest-api/src/workflows/maintenance.ts apps/rest-api/src/workflows/index.ts apps/rest-api/src/bootstrap.ts apps/rest-api/src/workflows/__tests__/maintenance-pack-gc.test.ts
git commit -m "feat(pack-gc): add DBOS pack GC workflow with scheduled execution"
```

---

### Task 5: PATCH /packs/:id endpoint

**Files:**

- Modify: `apps/rest-api/src/schemas.ts`
- Modify: `apps/rest-api/src/routes/packs.ts`

- [ ] **Step 1: Add TypeBox schema for pack update body**

In `apps/rest-api/src/schemas.ts`, add (near the other pack schemas):

```typescript
export const PackUpdateBodySchema = Type.Object(
  {
    pinned: Type.Optional(Type.Boolean()),
    expiresAt: Type.Optional(Type.String({ format: 'date-time' })),
  },
  { $id: 'PackUpdateBody' },
);
```

Register this schema in the Fastify instance if the project uses `addSchema` — check how other `$id` schemas are registered. If schemas are registered via `@fastify/swagger` auto-collection from route schemas, no extra registration is needed.

- [ ] **Step 2: Implement PATCH /packs/:id route**

In `apps/rest-api/src/routes/packs.ts`, add this route inside the `packRoutes` function, after the last `server.get` / `server.post`:

```typescript
const PackUpdateBodySchema = Type.Object({
  pinned: Type.Optional(Type.Boolean()),
  expiresAt: Type.Optional(Type.String({ format: 'date-time' })),
});

server.patch(
  '/packs/:id',
  {
    schema: {
      operationId: 'updateContextPack',
      tags: ['diary'],
      description:
        'Update a context pack — pin/unpin or change expiration. Only the diary owner can manage packs.',
      security: [{ bearerAuth: [] }],
      params: PackParamsSchema,
      body: PackUpdateBodySchema,
      response: {
        200: Type.Ref(ContextPackResponseSchema),
        400: Type.Ref(ProblemDetailsSchema),
        401: Type.Ref(ProblemDetailsSchema),
        403: Type.Ref(ProblemDetailsSchema),
        404: Type.Ref(ProblemDetailsSchema),
        500: Type.Ref(ProblemDetailsSchema),
      },
    },
  },
  async (request) => {
    const pack = await fastify.contextPackRepository.findById(
      request.params.id,
    );
    if (!pack) {
      throw createProblem('not-found', 'Context pack not found');
    }

    const allowed = await fastify.permissionChecker.canManagePack(
      pack.id,
      request.authContext!.identityId,
    );
    if (!allowed) {
      throw createProblem('forbidden', 'Not authorized to manage this pack');
    }

    const { pinned, expiresAt } = request.body;

    // Case 1: Pin the pack
    if (pinned === true) {
      const updated = await fastify.contextPackRepository.pin(pack.id);
      if (!updated) {
        throw createProblem('not-found', 'Context pack not found');
      }
      return updated;
    }

    // Case 2: Unpin the pack (requires expiresAt)
    if (pinned === false) {
      if (!expiresAt) {
        throw createProblem(
          'validation-failed',
          'expiresAt is required when setting pinned to false',
        );
      }
      const expiresAtDate = new Date(expiresAt);
      if (expiresAtDate <= new Date()) {
        throw createProblem(
          'validation-failed',
          'expiresAt must be in the future',
        );
      }
      const updated = await fastify.contextPackRepository.unpin(
        pack.id,
        expiresAtDate,
      );
      if (!updated) {
        throw createProblem('not-found', 'Context pack not found');
      }
      return updated;
    }

    // Case 3: Update expiresAt only (pack must be non-pinned)
    if (expiresAt !== undefined) {
      if (pack.pinned) {
        throw createProblem(
          'validation-failed',
          'Cannot set expiresAt on a pinned pack — unpin it first or send pinned: false together',
        );
      }
      const expiresAtDate = new Date(expiresAt);
      if (expiresAtDate <= new Date()) {
        throw createProblem(
          'validation-failed',
          'expiresAt must be in the future',
        );
      }
      const updated = await fastify.contextPackRepository.updateExpiry(
        pack.id,
        expiresAtDate,
      );
      if (!updated) {
        throw createProblem('not-found', 'Context pack not found');
      }
      return updated;
    }

    // No meaningful fields provided
    throw createProblem(
      'validation-failed',
      'At least one of pinned or expiresAt must be provided',
    );
  },
);
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-pack-gc && pnpm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/rest-api/src/routes/packs.ts apps/rest-api/src/schemas.ts
git commit -m "feat(pack-gc): add PATCH /packs/:id for pin/unpin and expiry update"
```

---

### Task 6: `packs_update` MCP tool

**Files:**

- Modify: `apps/mcp-server/src/schemas.ts`
- Modify: `apps/mcp-server/src/pack-tools.ts`

- [ ] **Step 1: Add MCP schema for pack update**

In `apps/mcp-server/src/schemas.ts`, add after the `PackProvenanceSchema` block:

```typescript
export const PackUpdateSchema = Type.Object({
  pack_id: Type.String({
    description: 'Context pack ID (UUID) to update.',
  }),
  pinned: Type.Optional(
    Type.Boolean({
      description:
        'Set to true to pin (exempt from GC, clears expiresAt). Set to false to unpin (requires expires_at).',
    }),
  ),
  expires_at: Type.Optional(
    Type.String({
      description:
        'ISO 8601 expiration date. Required when unpinning. Must be in the future.',
    }),
  ),
});
export type PackUpdateInput = Static<typeof PackUpdateSchema>;
```

Add the import for `UpdateContextPackData` from `@moltnet/api-client` when it becomes available after OpenAPI regeneration. For now, define the type inline:

```typescript
// TODO: replace with generated type after pnpm run generate:openapi
```

Also add the drift-check type alias at the bottom with the other ones.

- [ ] **Step 2: Add handler and registration**

In `apps/mcp-server/src/pack-tools.ts`:

Add import for the API client function (will exist after OpenAPI regen):

```typescript
import {
  // ...existing imports
  updateContextPack,
} from '@moltnet/api-client';
```

Add import for the new schema/type:

```typescript
import type { PackUpdateInput } from './schemas.js';
import { PackUpdateSchema } from './schemas.js';
```

Add handler:

```typescript
export async function handlePacksUpdate(
  args: PackUpdateInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'packs_update' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await updateContextPack({
    client: deps.client,
    auth: () => token,
    path: { id: args.pack_id },
    body: {
      ...(args.pinned !== undefined && { pinned: args.pinned }),
      ...(args.expires_at !== undefined && { expiresAt: args.expires_at }),
    },
  });

  if (error) {
    deps.logger.error({ tool: 'packs_update', err: error }, 'tool.error');
    return errorResult(extractApiErrorMessage(error, 'Failed to update pack'));
  }

  return textResult({ pack: data });
}
```

Add registration in `registerPackTools`:

```typescript
fastify.mcpAddTool(
  {
    name: 'packs_update',
    description:
      'Update a context pack — pin/unpin or change expiration date. ' +
      'Pin a pack to protect it from garbage collection. ' +
      'When unpinning, expires_at is required.',
    inputSchema: PackUpdateSchema,
  },
  async (args, ctx) => handlePacksUpdate(args, deps, ctx),
);
```

- [ ] **Step 3: Generate OpenAPI spec and API client**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-pack-gc && pnpm run generate:openapi`

This regenerates the API client with the new `updateContextPack` function.

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-pack-gc && pnpm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/mcp-server/src/schemas.ts apps/mcp-server/src/pack-tools.ts libs/api-client/
git commit -m "feat(mcp): add packs_update tool for pin/unpin and expiry management"
```

---

### Task 7: Final validation

- [ ] **Step 1: Run full lint**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-pack-gc && pnpm run lint`
Expected: PASS (fix any lint issues)

- [ ] **Step 2: Run full typecheck**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-pack-gc && pnpm run typecheck`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-pack-gc && pnpm run test`
Expected: PASS

- [ ] **Step 4: Run build**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-pack-gc && pnpm run build`
Expected: PASS

- [ ] **Step 5: Commit any remaining fixes**

If lint/typecheck/test required fixes, commit them:

```bash
git commit -m "fix: address lint and typecheck issues from pack GC implementation"
```
