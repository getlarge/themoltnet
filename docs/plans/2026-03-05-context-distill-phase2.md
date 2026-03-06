# Context Distill Phase 2 — REST API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split `diary.ts` into three focused route files, add a `fetchEmbeddings` repository method, implement `consolidateWorkflow` and `compileWorkflow` as DBOS queue workflows, expose them as `POST /diaries/:id/consolidate` and `POST /diaries/:id/compile`, and regenerate the api-client.

**Architecture:** Two DBOS `WorkflowQueue`s (one per workflow type, partitioned by `identity_id` for per-agent concurrency limits) with `deduplicationID` for idempotency. Routes verify diary access, compute a deterministic dedup key, enqueue via DBOS, and `await getResult()`. A new `fetchEmbeddings(ids)` repository method returns `{id, embedding}[]` cheaply (SELECT id, embedding only), keeping entry payloads free of the 384-dim vector.

**Tech Stack:** TypeScript strict, Fastify + TypeBox, DBOS (`WorkflowQueue`, `DBOS.registerWorkflow`, `DBOS.registerStep`, `DBOS.startWorkflow`), `@moltnet/context-distill` (pure functions), Drizzle ORM, Vitest (AAA pattern).

---

## Context

### Key files to understand before starting

- `apps/rest-api/src/routes/diary.ts` — 1106-line monolith being split
- `apps/rest-api/src/app.ts` — registers routes, decorates fastify instance
- `apps/rest-api/src/schemas.ts` — TypeBox schemas + `sharedSchemas` array
- `apps/rest-api/src/types.ts` — `FastifyInstance` augmentation
- `apps/rest-api/__tests__/helpers.ts` — `createMockServices()`, `createTestApp()`
- `libs/diary-service/src/workflows/diary-workflows.ts` — DBOS workflow pattern to follow
- `apps/rest-api/src/workflows/registration-workflow.ts` — another DBOS workflow pattern
- `libs/database/src/repositories/diary-entry.repository.ts` — repository to extend
- `libs/context-distill/src/consolidate.ts` — `consolidate(entries, options)` → `ConsolidateResult`
- `libs/context-distill/src/compile.ts` — `compile(entries, options)` → `CompileResult`
- `libs/context-distill/src/types.ts` — `DistillEntry`, `ConsolidateResult`, `CompileResult`

### Route split (what goes where)

**`diary.ts`** keeps: diary container CRUD (create/list/get/update/delete) + sharing (listShares, shareDiary, listInvitations, acceptInvitation, declineInvitation, revokeDiaryShare).

**`diary-entries.ts`** gets: createDiaryEntry, listDiaryEntries, getDiaryEntry, verifyDiaryEntry, updateDiaryEntry, deleteDiaryEntry, searchDiary.

**`diary-distill.ts`** gets: reflect (moved from diary.ts) + consolidate + compile (new).

### DBOS queue pattern

```typescript
import { WorkflowQueue, DBOS } from '@moltnet/database';

// Declared at module level (before DBOS.launch())
const consolidateQueue = new WorkflowQueue('context.consolidate', {
  concurrency: 1,
  partitionQueue: true,   // per-agent via queuePartitionKey: identityId
});

// In initContextDistillWorkflows():
const _consolidateWorkflow = DBOS.registerWorkflow(async (input) => { ... }, { name: 'context.consolidate' });

// In route handler:
const handle = await DBOS.startWorkflow(_consolidateWorkflow, {
  queueName: 'context.consolidate',
  enqueueOptions: { deduplicationID, queuePartitionKey: identityId },
})(input);
const result = await handle.getResult();
```

### DiaryEntryRepository type

`DiaryEntryRepository` is inferred from the return type of `createDiaryEntryRepository(db)` in `libs/database/src/repositories/diary-entry.repository.ts`. When you add `fetchEmbeddings` to the repository factory, the type automatically includes it everywhere. No manual interface editing needed.

### signingNonce field

`diary.ts` currently serializes `signingNonce` as part of entry responses. The `DiaryEntrySchema` in `schemas.ts` does NOT include `signingNonce` (it's internal). When splitting, keep this consistent — do not add `signingNonce` to the schema.

---

## Task 1: Split `diary.ts` → `diary-entries.ts` + trim `diary.ts`

**Files:**

- Create: `apps/rest-api/src/routes/diary-entries.ts`
- Modify: `apps/rest-api/src/routes/diary.ts`
- Modify: `apps/rest-api/src/app.ts`
- Rename test file: `apps/rest-api/__tests__/diary.test.ts` → split into `diary.test.ts` + `diary-entries.test.ts`

**Step 1: Create `diary-entries.ts`**

Move these route handlers verbatim from `diary.ts` to a new `diaryEntryRoutes` function:

- `POST /diaries/:diaryId/entries` (createDiaryEntry)
- `GET /diaries/:diaryId/entries` (listDiaryEntries)
- `GET /diaries/:diaryId/entries/:entryId` (getDiaryEntry)
- `GET /diaries/:diaryId/entries/:entryId/verify` (verifyDiaryEntry)
- `PATCH /diaries/:diaryId/entries/:entryId` (updateDiaryEntry)
- `DELETE /diaries/:diaryId/entries/:entryId` (deleteDiaryEntry)
- `POST /diaries/search` (searchDiary)

The file structure:

```typescript
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import { computeContentCid } from '@moltnet/crypto-service';
import { DiaryServiceError } from '@moltnet/diary-service';
import {
  DiaryEntryParamsSchema,
  NestedDiaryParamsSchema,
  ProblemDetailsSchema,
} from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import {
  DiaryEntrySchema,
  DiaryListSchema,
  DiarySearchResultSchema,
  EntryVerifyResultSchema,
  SuccessSchema,
} from '../schemas.js';

function translateServiceError(err: DiaryServiceError): never {
  // copy verbatim from diary.ts
}

export async function diaryEntryRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);
  // ... all 7 routes moved here
}
```

**Step 2: Trim `diary.ts`**

Delete the 7 moved routes and the `translateServiceError` function from `diary.ts`. Keep only the diary container + sharing routes. Also remove imports that are only used by the moved routes (`computeContentCid`, `DiaryEntryParamsSchema`, `DiaryEntrySchema`, `DiaryListSchema`, `DiarySearchResultSchema`, `EntryVerifyResultSchema`).

**Step 3: Register `diaryEntryRoutes` in `app.ts`**

```typescript
// app.ts — add import
import { diaryEntryRoutes } from './routes/diary-entries.js';

// in registerApiRoutes(), after diaryRoutes:
await app.register(diaryEntryRoutes);
```

**Step 4: Run tests**

```bash
pnpm --filter @moltnet/rest-api run test
```

Expected: all existing diary tests still pass (routes are identical, just moved).

**Step 5: Split `diary.test.ts`**

Move entry-related test cases to `apps/rest-api/__tests__/diary-entries.test.ts`. Keep only diary container + sharing tests in `diary.test.ts`. Both files import from `./helpers.js`.

**Step 6: Run tests again**

```bash
pnpm --filter @moltnet/rest-api run test
```

Expected: all tests pass.

**Step 7: Commit**

```bash
git add apps/rest-api/src/routes/diary-entries.ts \
        apps/rest-api/src/routes/diary.ts \
        apps/rest-api/src/app.ts \
        apps/rest-api/__tests__/diary.test.ts \
        apps/rest-api/__tests__/diary-entries.test.ts
git commit -m "refactor(rest-api): split diary routes into diary + diary-entries"
```

---

## Task 2: Create `diary-distill.ts` with `reflect` moved in

**Files:**

- Create: `apps/rest-api/src/routes/diary-distill.ts`
- Modify: `apps/rest-api/src/routes/diary.ts` (remove reflect)
- Modify: `apps/rest-api/src/app.ts`
- Create: `apps/rest-api/__tests__/diary-distill.test.ts`

**Step 1: Create `diary-distill.ts` with reflect only**

```typescript
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import { DiaryServiceError } from '@moltnet/diary-service';
import { ProblemDetailsSchema } from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import { DigestSchema } from '../schemas.js';

function translateServiceError(err: DiaryServiceError): never {
  switch (err.code) {
    case 'not_found':
      throw createProblem('not-found', err.message);
    case 'forbidden':
      throw createProblem('forbidden', err.message);
    case 'self_share':
    case 'validation_failed':
    case 'wrong_status':
      throw createProblem('validation-failed', err.message);
    case 'already_shared':
    case 'immutable':
      throw createProblem('conflict', err.message);
    default:
      throw createProblem('internal', err.message);
  }
}

export async function diaryDistillRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

  // ── Reflect ────────────────────────────────────────────────
  // Move the GET /diaries/reflect handler verbatim from diary.ts
}
```

**Step 2: Remove reflect from `diary.ts`**

Delete the `GET /diaries/reflect` handler and its unused imports (`DigestSchema`).

**Step 3: Register `diaryDistillRoutes` in `app.ts`**

```typescript
import { diaryDistillRoutes } from './routes/diary-distill.js';
// ...
await app.register(diaryDistillRoutes);
```

**Step 4: Run tests, verify reflect tests still pass**

```bash
pnpm --filter @moltnet/rest-api run test
```

**Step 5: Move reflect tests to `diary-distill.test.ts`**

Create `apps/rest-api/__tests__/diary-distill.test.ts` with the reflect test cases extracted from `diary.test.ts`.

**Step 6: Run tests**

```bash
pnpm --filter @moltnet/rest-api run test
```

Expected: all tests pass.

**Step 7: Commit**

```bash
git add apps/rest-api/src/routes/diary-distill.ts \
        apps/rest-api/src/routes/diary.ts \
        apps/rest-api/src/app.ts \
        apps/rest-api/__tests__/diary-distill.test.ts \
        apps/rest-api/__tests__/diary.test.ts
git commit -m "refactor(rest-api): move reflect to diary-distill route file"
```

---

## Task 3: Add `fetchEmbeddings` to diary-entry repository

**Files:**

- Modify: `libs/database/src/repositories/diary-entry.repository.ts`
- Modify: `apps/rest-api/__tests__/helpers.ts` (add mock)

**Step 1: Write the failing test**

Add to `libs/database/src/repositories/__tests__/diary-entry.repository.test.ts` (or create it if missing — check with `ls libs/database/src/repositories/__tests__/`):

```typescript
// If no unit test file exists for the repository, this is tested via the route tests
// in Task 6. Skip to Step 3.
```

Since repository tests typically require a real DB, skip unit tests here. The method will be integration-tested via route tests in Task 6.

**Step 2: Add `fetchEmbeddings` to the repository factory**

In `libs/database/src/repositories/diary-entry.repository.ts`, add after the `list` method (around line 250):

```typescript
/**
 * Fetch embeddings for a list of entry IDs.
 * Returns only { id, embedding } — no content or metadata overhead.
 * Used by context-distill workflows that need vectors for clustering/MMR.
 */
async fetchEmbeddings(
  ids: string[],
): Promise<{ id: string; embedding: number[] }[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: diaryEntries.id, embedding: diaryEntries.embedding })
    .from(diaryEntries)
    .where(inArray(diaryEntries.id, ids));
  return rows
    .filter((r) => r.embedding !== null)
    .map((r) => ({ id: r.id, embedding: r.embedding as number[] }));
},
```

Note: `diaryEntries.embedding` is included here (not excluded like in `publicColumns`). This is intentional — this method exists solely to return embeddings.

**Step 3: Update mock in `helpers.ts`**

```typescript
// In MockServices.diaryEntryRepository:
fetchEmbeddings: ReturnType<typeof vi.fn>;

// In createMockServices():
diaryEntryRepository: {
  // ... existing mocks ...
  fetchEmbeddings: vi.fn().mockResolvedValue([]),
},
```

**Step 4: Run typecheck**

```bash
pnpm --filter @moltnet/database run typecheck
pnpm --filter @moltnet/rest-api run typecheck
```

Expected: clean — `DiaryEntryRepository` type now includes `fetchEmbeddings` everywhere it's used.

**Step 5: Commit**

```bash
git add libs/database/src/repositories/diary-entry.repository.ts \
        apps/rest-api/__tests__/helpers.ts
git commit -m "feat(database): add fetchEmbeddings to diary-entry repository"
```

---

## Task 4: Add context-distill TypeBox schemas to `schemas.ts`

**Files:**

- Modify: `apps/rest-api/src/schemas.ts`

**Step 1: Add consolidate + compile response schemas**

At the end of `schemas.ts`, before `sharedSchemas`, add:

```typescript
// ── Context Distill ─────────────────────────────────────────

const DistillEntryRefSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  content: Type.String(),
  tokens: Type.Number(),
  importance: Type.Number({ minimum: 1, maximum: 10 }),
  createdAt: DateTime,
});

const ClusterSchema = Type.Object({
  representative: DistillEntryRefSchema,
  representativeReason: Type.String(),
  members: Type.Array(DistillEntryRefSchema),
  similarity: Type.Number({ minimum: 0, maximum: 1 }),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  suggestedAction: Type.Union([
    Type.Literal('merge'),
    Type.Literal('keep_separate'),
    Type.Literal('review'),
  ]),
});

export const ConsolidateResultSchema = Type.Object(
  {
    workflowId: Type.String(),
    clusters: Type.Array(ClusterSchema),
    stats: Type.Object({
      inputCount: Type.Number(),
      clusterCount: Type.Number(),
      singletonRate: Type.Number(),
      clusterSizeDistribution: Type.Tuple([
        Type.Number(),
        Type.Number(),
        Type.Number(),
        Type.Number(),
        Type.Number(),
      ]),
      elapsedMs: Type.Number(),
    }),
    trace: Type.Object({
      thresholdUsed: Type.Number(),
      strategyUsed: Type.Union([
        Type.Literal('score'),
        Type.Literal('centroid'),
        Type.Literal('hybrid'),
      ]),
      embeddingDim: Type.Number(),
    }),
  },
  { $id: 'ConsolidateResult' },
);

const CompiledEntrySchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  content: Type.String(),
  compressionLevel: Type.Union([
    Type.Literal('full'),
    Type.Literal('summary'),
    Type.Literal('keywords'),
  ]),
  originalTokens: Type.Number(),
  compressedTokens: Type.Number(),
});

export const CompileResultSchema = Type.Object(
  {
    entries: Type.Array(CompiledEntrySchema),
    stats: Type.Object({
      totalTokens: Type.Number(),
      entriesIncluded: Type.Number(),
      entriesCompressed: Type.Number(),
      compressionRatio: Type.Number(),
      budgetUtilization: Type.Number(),
      elapsedMs: Type.Number(),
    }),
    trace: Type.Object({
      lambdaUsed: Type.Number(),
      embeddingDim: Type.Number(),
      taskPromptHash: Type.Optional(Type.String()),
    }),
  },
  { $id: 'CompileResult' },
);
```

**Step 2: Add to `sharedSchemas`**

```typescript
export const sharedSchemas = [
  // ... existing entries ...
  ConsolidateResultSchema,
  CompileResultSchema,
];
```

**Step 3: Run typecheck**

```bash
pnpm --filter @moltnet/rest-api run typecheck
```

**Step 4: Commit**

```bash
git add apps/rest-api/src/schemas.ts
git commit -m "feat(rest-api): add ConsolidateResult and CompileResult TypeBox schemas"
```

---

## Task 5: Implement `context-distill-workflows.ts`

**Files:**

- Create: `apps/rest-api/src/workflows/context-distill-workflows.ts`
- Modify: `apps/rest-api/src/workflows/index.ts`

**Step 1: Create the workflow file**

```typescript
/**
 * Context Distill DBOS Workflows
 *
 * consolidateWorkflow: fetch entries + embeddings → cluster() + select() → ConsolidateResult
 * compileWorkflow:     embed query → search entries → fetch embeddings → compile() → CompileResult
 *
 * Both workflows use WorkflowQueue with partitionQueue:true for per-agent concurrency.
 * deduplicationID ensures same input returns cached result without re-running computation.
 *
 * ## Initialization Order
 *
 * Call initContextDistillWorkflows() AFTER configureDBOS() and BEFORE launchDBOS().
 * Call setContextDistillDeps() before any workflow is invoked.
 */

import {
  compile,
  type CompileOptions,
  consolidate,
  type ConsolidateOptions,
} from '@moltnet/context-distill';
import type { DiaryEntryRepository } from '@moltnet/database';
import { DBOS, WorkflowQueue } from '@moltnet/database';
import type { EmbeddingService } from '@moltnet/embedding-service';
import { estimateTokens } from '@moltnet/context-distill';

// ── Queues ─────────────────────────────────────────────────────

export const consolidateQueue = new WorkflowQueue('context.consolidate', {
  concurrency: 1,
  partitionQueue: true,
});

export const compileQueue = new WorkflowQueue('context.compile', {
  concurrency: 5,
  partitionQueue: true,
});

// ── Types ──────────────────────────────────────────────────────

export interface ContextDistillDeps {
  diaryEntryRepository: DiaryEntryRepository;
  embeddingService: EmbeddingService;
}

export interface ConsolidateWorkflowInput {
  diaryId: string;
  identityId: string;
  entryIds?: string[];
  tags?: string[];
  threshold?: number;
  strategy?: ConsolidateOptions['strategy'];
}

export interface CompileWorkflowInput {
  diaryId: string;
  identityId: string;
  taskPrompt?: string;
  tokenBudget: number;
  lambda?: number;
  includeTags?: string[];
  excludeTags?: string[];
  wRecency?: number;
  wImportance?: number;
  limit?: number;
}

// ── Dependency Injection ───────────────────────────────────────

let deps: ContextDistillDeps | null = null;

export function setContextDistillDeps(d: ContextDistillDeps): void {
  deps = d;
}

function getDeps(): ContextDistillDeps {
  if (!deps)
    throw new Error(
      'Context distill deps not set. Call setContextDistillDeps() first.',
    );
  return deps;
}

// ── Lazy Registration ──────────────────────────────────────────

type ConsolidateWorkflowFn = (
  input: ConsolidateWorkflowInput,
) => Promise<
  import('@moltnet/context-distill').ConsolidateResult & { workflowId: string }
>;
type CompileWorkflowFn = (
  input: CompileWorkflowInput,
) => Promise<import('@moltnet/context-distill').CompileResult>;

let _workflows: {
  consolidate: ConsolidateWorkflowFn;
  compile: CompileWorkflowFn;
} | null = null;

export function initContextDistillWorkflows(): void {
  if (_workflows) return;

  // ── Steps ──────────────────────────────────────────────────

  const fetchEntriesStep = DBOS.registerStep(
    async (
      diaryId: string,
      entryIds?: string[],
      tags?: string[],
      limit = 500,
    ): Promise<
      Array<{
        id: string;
        content: string;
        importance: number;
        createdAt: Date;
        tags: string[] | null;
      }>
    > => {
      const { diaryEntryRepository } = getDeps();
      if (entryIds && entryIds.length > 0) {
        const entries = await diaryEntryRepository.list({
          diaryId,
          limit: Math.min(entryIds.length, 500),
        });
        // Filter to requested ids
        const idSet = new Set(entryIds);
        return entries.filter((e) => idSet.has(e.id));
      }
      return diaryEntryRepository.list({
        diaryId,
        tags,
        limit,
        excludeSuperseded: true,
      });
    },
    { name: 'context-distill.step.fetchEntries' },
  );

  const fetchEmbeddingsStep = DBOS.registerStep(
    async (
      ids: string[],
    ): Promise<Array<{ id: string; embedding: number[] }>> => {
      const { diaryEntryRepository } = getDeps();
      return diaryEntryRepository.fetchEmbeddings(ids);
    },
    { name: 'context-distill.step.fetchEmbeddings' },
  );

  const embedQueryStep = DBOS.registerStep(
    async (query: string): Promise<number[]> => {
      const { embeddingService } = getDeps();
      try {
        return await embeddingService.embedQuery(query);
      } catch {
        return [];
      }
    },
    { name: 'context-distill.step.embedQuery' },
  );

  const searchEntriesStep = DBOS.registerStep(
    async (
      diaryId: string,
      tags: string[] | undefined,
      wRecency: number,
      wImportance: number,
      limit: number,
    ): Promise<
      Array<{
        id: string;
        content: string;
        importance: number;
        createdAt: Date;
      }>
    > => {
      const { diaryEntryRepository } = getDeps();
      return diaryEntryRepository.search({
        diaryId,
        tags,
        wRecency,
        wImportance,
        limit,
        excludeSuperseded: true,
      });
    },
    { name: 'context-distill.step.searchEntries' },
  );

  // ── Workflows ──────────────────────────────────────────────

  const consolidateWorkflow = DBOS.registerWorkflow(
    async (input: ConsolidateWorkflowInput) => {
      const entries = await fetchEntriesStep(
        input.diaryId,
        input.entryIds,
        input.tags,
        500,
      );

      if (entries.length === 0) {
        return {
          workflowId: DBOS.workflowID ?? '',
          clusters: [],
          stats: {
            inputCount: 0,
            clusterCount: 0,
            singletonRate: 0,
            clusterSizeDistribution: [0, 0, 0, 0, 0] as [
              number,
              number,
              number,
              number,
              number,
            ],
            elapsedMs: 0,
          },
          trace: {
            thresholdUsed: input.threshold ?? 0.15,
            strategyUsed: (input.strategy ?? 'hybrid') as
              | 'score'
              | 'centroid'
              | 'hybrid',
            embeddingDim: 0,
          },
        };
      }

      const ids = entries.map((e) => e.id);
      const embeddingRows = await fetchEmbeddingsStep(ids);
      const embeddingMap = new Map(
        embeddingRows.map((r) => [r.id, r.embedding]),
      );

      // Build DistillEntry[] — entries without embeddings are skipped
      const distillEntries = entries
        .filter((e) => embeddingMap.has(e.id))
        .map((e) => ({
          id: e.id,
          embedding: embeddingMap.get(e.id)!,
          content: e.content,
          tokens: estimateTokens(e.content),
          importance: e.importance,
          createdAt:
            e.createdAt instanceof Date
              ? e.createdAt.toISOString()
              : e.createdAt,
        }));

      const result = consolidate(distillEntries, {
        threshold: input.threshold,
        strategy: input.strategy,
      });

      return { workflowId: DBOS.workflowID ?? '', ...result };
    },
    { name: 'context.consolidate' },
  );

  const compileWorkflow = DBOS.registerWorkflow(
    async (input: CompileWorkflowInput) => {
      const taskPromptEmbedding = input.taskPrompt
        ? await embedQueryStep(input.taskPrompt)
        : undefined;

      const limit = input.limit ?? 200;
      const entries = await searchEntriesStep(
        input.diaryId,
        input.includeTags,
        input.wRecency ?? 0,
        input.wImportance ?? 0,
        limit,
      );

      if (entries.length === 0) {
        const { compile: compileFn } = await import('@moltnet/context-distill');
        return compileFn([], {
          tokenBudget: input.tokenBudget,
          taskPromptEmbedding,
          lambda: input.lambda,
        });
      }

      const ids = entries.map((e) => e.id);
      const embeddingRows = await fetchEmbeddingsStep(ids);
      const embeddingMap = new Map(
        embeddingRows.map((r) => [r.id, r.embedding]),
      );

      const distillEntries = entries
        .filter((e) => embeddingMap.has(e.id))
        .map((e) => ({
          id: e.id,
          embedding: embeddingMap.get(e.id)!,
          content: e.content,
          tokens: estimateTokens(e.content),
          importance: e.importance,
          createdAt:
            e.createdAt instanceof Date
              ? e.createdAt.toISOString()
              : e.createdAt,
        }));

      return compile(distillEntries, {
        tokenBudget: input.tokenBudget,
        taskPromptEmbedding: taskPromptEmbedding?.length
          ? taskPromptEmbedding
          : undefined,
        lambda: input.lambda,
      });
    },
    { name: 'context.compile' },
  );

  _workflows = { consolidate: consolidateWorkflow, compile: compileWorkflow };
}

// ── Exported Collection ────────────────────────────────────────

export const contextDistillWorkflows = {
  get consolidate() {
    if (!_workflows)
      throw new Error(
        'Context distill workflows not initialized. Call initContextDistillWorkflows() after configureDBOS().',
      );
    return _workflows.consolidate.bind(undefined);
  },
  get compile() {
    if (!_workflows)
      throw new Error(
        'Context distill workflows not initialized. Call initContextDistillWorkflows() after configureDBOS().',
      );
    return _workflows.compile.bind(undefined);
  },
};
```

**Note on `estimateTokens` import:** `@moltnet/context-distill` exports `estimateTokens` from `compress.ts` via `index.ts`. Verify with:

```bash
grep -n 'estimateTokens' libs/context-distill/src/index.ts
```

If not exported, add it.

**Note on `DBOS.workflowID`:** Check the DBOS SDK for the correct way to get the current workflow ID inside a workflow. It may be `DBOS.workflowID` or passed differently. Check:

```bash
grep -rn 'workflowID\|workflowId\|getWorkflowId' node_modules/@dbos-inc/dbos-sdk/dist/src/dbos.d.ts | head -20
```

**Step 2: Export from `workflows/index.ts`**

```typescript
export {
  consolidateQueue,
  compileQueue,
  contextDistillWorkflows,
  initContextDistillWorkflows,
  setContextDistillDeps,
  type ContextDistillDeps,
  type ConsolidateWorkflowInput,
  type CompileWorkflowInput,
} from './context-distill-workflows.js';
```

**Step 3: Run typecheck**

```bash
pnpm --filter @moltnet/rest-api run typecheck
```

**Step 4: Commit**

```bash
git add apps/rest-api/src/workflows/context-distill-workflows.ts \
        apps/rest-api/src/workflows/index.ts
git commit -m "feat(rest-api): add consolidateWorkflow and compileWorkflow DBOS workflows"
```

---

## Task 6: Add `consolidate` and `compile` routes to `diary-distill.ts`

**Files:**

- Modify: `apps/rest-api/src/routes/diary-distill.ts`
- Modify: `apps/rest-api/__tests__/diary-distill.test.ts`

**Step 1: Write failing tests for both routes**

In `apps/rest-api/__tests__/diary-distill.test.ts`, add:

```typescript
import {
  createMockServices,
  createTestApp,
  DIARY_ID,
  OWNER_ID,
  TEST_BEARER_TOKEN,
  VALID_AUTH_CONTEXT,
  type MockServices,
} from './helpers.js';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the DBOS workflows module — we don't want DBOS infrastructure in unit tests
vi.mock('../src/workflows/context-distill-workflows.js', () => ({
  contextDistillWorkflows: {
    get consolidate() {
      return vi.fn();
    },
    get compile() {
      return vi.fn();
    },
  },
  consolidateQueue: {},
  compileQueue: {},
}));

const authHeaders = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };

describe('POST /diaries/:id/consolidate', () => {
  let app: FastifyInstance;
  let mocks: MockServices;
  let mockConsolidate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    mocks.diaryService.findDiary.mockResolvedValue({
      id: DIARY_ID,
      ownerId: OWNER_ID,
      name: 'test',
      visibility: 'private',
      signed: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockConsolidate = vi.fn().mockResolvedValue({
      workflowId: 'wf-123',
      clusters: [],
      stats: {
        inputCount: 0,
        clusterCount: 0,
        singletonRate: 0,
        clusterSizeDistribution: [0, 0, 0, 0, 0],
        elapsedMs: 1,
      },
      trace: { thresholdUsed: 0.15, strategyUsed: 'hybrid', embeddingDim: 0 },
    });
  });

  it('returns 200 with consolidation result', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/diaries/${DIARY_ID}/consolidate`,
      headers: authHeaders,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty('workflowId');
    expect(response.json()).toHaveProperty('clusters');
  });

  it('returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/diaries/${DIARY_ID}/consolidate`,
      payload: {},
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 404 when diary not found', async () => {
    const { DiaryServiceError } = await import('@moltnet/diary-service');
    mocks.diaryService.findDiary.mockRejectedValue(
      new DiaryServiceError('not_found', 'Diary not found or access denied'),
    );
    const response = await app.inject({
      method: 'POST',
      url: `/diaries/${DIARY_ID}/consolidate`,
      headers: authHeaders,
      payload: {},
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /diaries/:id/compile', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    mocks.diaryService.findDiary.mockResolvedValue({
      id: DIARY_ID,
      ownerId: OWNER_ID,
      name: 'test',
      visibility: 'private',
      signed: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it('returns 200 with compile result', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/diaries/${DIARY_ID}/compile`,
      headers: authHeaders,
      payload: { tokenBudget: 4000 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty('entries');
    expect(response.json()).toHaveProperty('stats');
  });

  it('returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/diaries/${DIARY_ID}/compile`,
      payload: { tokenBudget: 4000 },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 400 when tokenBudget missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/diaries/${DIARY_ID}/compile`,
      headers: authHeaders,
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });
});
```

**Step 2: Run tests to confirm they fail**

```bash
pnpm --filter @moltnet/rest-api run test -- diary-distill
```

Expected: 404 (routes not registered yet).

**Step 3: Add the two routes to `diary-distill.ts`**

```typescript
// Add to imports
import { DiaryServiceError } from '@moltnet/diary-service';
import { DiaryParamsSchema, ProblemDetailsSchema } from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import { createHash } from 'node:crypto';

import { contextDistillWorkflows } from '../workflows/context-distill-workflows.js';
import { CompileResultSchema, ConsolidateResultSchema } from '../schemas.js';

// In diaryDistillRoutes():

// ── Consolidate ────────────────────────────────────────────────
server.post(
  '/diaries/:id/consolidate',
  {
    schema: {
      operationId: 'consolidateDiary',
      tags: ['diary'],
      description:
        'Cluster semantically similar entries and return consolidation suggestions.',
      security: [{ bearerAuth: [] }],
      params: DiaryParamsSchema,
      body: Type.Object({
        entryIds: Type.Optional(
          Type.Array(Type.String({ format: 'uuid' }), { maxItems: 500 }),
        ),
        tags: Type.Optional(
          Type.Array(Type.String({ maxLength: 50 }), { maxItems: 20 }),
        ),
        threshold: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
        strategy: Type.Optional(
          Type.Union([
            Type.Literal('score'),
            Type.Literal('centroid'),
            Type.Literal('hybrid'),
          ]),
        ),
      }),
      response: {
        200: Type.Ref(ConsolidateResultSchema),
        401: Type.Ref(ProblemDetailsSchema),
        403: Type.Ref(ProblemDetailsSchema),
        404: Type.Ref(ProblemDetailsSchema),
        500: Type.Ref(ProblemDetailsSchema),
      },
    },
  },
  async (request) => {
    const { id: diaryId } = request.params;
    const identityId = request.authContext!.identityId;
    const { entryIds, tags, threshold, strategy } = request.body;

    try {
      await fastify.diaryService.findDiary(diaryId, identityId);
    } catch (err) {
      if (err instanceof DiaryServiceError) translateServiceError(err);
      throw err;
    }

    // Deterministic dedup key: same diary + same filter = same result
    const dedupRaw = entryIds?.length
      ? `${diaryId}:ids:${[...entryIds].sort().join(',')}`
      : `${diaryId}:tags:${[...(tags ?? [])].sort().join(',')}:threshold:${threshold ?? 0.15}:strategy:${strategy ?? 'hybrid'}`;
    const deduplicationID = createHash('sha256').update(dedupRaw).digest('hex');

    const handle = await DBOS.startWorkflow(
      contextDistillWorkflows.consolidate,
      {
        queueName: 'context.consolidate',
        enqueueOptions: {
          deduplicationID,
          queuePartitionKey: identityId,
        },
      },
    )({ diaryId, identityId, entryIds, tags, threshold, strategy });

    return handle.getResult();
  },
);

// ── Compile ─────────────────────────────────────────────────────
server.post(
  '/diaries/:id/compile',
  {
    schema: {
      operationId: 'compileDiary',
      tags: ['diary'],
      description:
        'Compile a token-budget-fitted context pack from diary entries.',
      security: [{ bearerAuth: [] }],
      params: DiaryParamsSchema,
      body: Type.Object({
        tokenBudget: Type.Integer({ minimum: 1, maximum: 100000 }),
        taskPrompt: Type.Optional(
          Type.String({ minLength: 1, maxLength: 2000 }),
        ),
        lambda: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
        includeTags: Type.Optional(
          Type.Array(Type.String({ maxLength: 50 }), { maxItems: 20 }),
        ),
        excludeTags: Type.Optional(
          Type.Array(Type.String({ maxLength: 50 }), { maxItems: 20 }),
        ),
        wRecency: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
        wImportance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      }),
      response: {
        200: Type.Ref(CompileResultSchema),
        400: Type.Ref(ProblemDetailsSchema),
        401: Type.Ref(ProblemDetailsSchema),
        403: Type.Ref(ProblemDetailsSchema),
        404: Type.Ref(ProblemDetailsSchema),
        500: Type.Ref(ProblemDetailsSchema),
      },
    },
  },
  async (request) => {
    const { id: diaryId } = request.params;
    const identityId = request.authContext!.identityId;
    const {
      tokenBudget,
      taskPrompt,
      lambda,
      includeTags,
      wRecency,
      wImportance,
    } = request.body;

    try {
      await fastify.diaryService.findDiary(diaryId, identityId);
    } catch (err) {
      if (err instanceof DiaryServiceError) translateServiceError(err);
      throw err;
    }

    // Dedup key: diary + latest state signal + prompt + budget
    // We use a timestamp-truncated-to-minute as a "latest entry" proxy
    // when we don't want to fetch the latest entry ID just for the key.
    // For exact dedup, the caller can pass the same parameters at the same time.
    const promptHash = taskPrompt
      ? createHash('sha256').update(taskPrompt).digest('hex').slice(0, 16)
      : 'noprompt';
    const dedupRaw = `${diaryId}:${promptHash}:budget:${tokenBudget}:lambda:${lambda ?? 0.5}:ts:${Math.floor(Date.now() / 60000)}`;
    const deduplicationID = createHash('sha256').update(dedupRaw).digest('hex');

    const handle = await DBOS.startWorkflow(contextDistillWorkflows.compile, {
      queueName: 'context.compile',
      enqueueOptions: {
        deduplicationID,
        queuePartitionKey: identityId,
      },
    })({
      diaryId,
      identityId,
      taskPrompt,
      tokenBudget,
      lambda,
      includeTags,
      wRecency,
      wImportance,
    });

    return handle.getResult();
  },
);
```

Also add `import { DBOS } from '@moltnet/database';` to the top of `diary-distill.ts`.

**Step 4: Register the route in `app.ts`**

The route is already registered from Task 2. No change needed.

**Step 5: Run tests**

```bash
pnpm --filter @moltnet/rest-api run test -- diary-distill
```

Expected: all tests pass.

**Step 6: Run full test suite**

```bash
pnpm --filter @moltnet/rest-api run test
```

Expected: all tests pass.

**Step 7: Commit**

```bash
git add apps/rest-api/src/routes/diary-distill.ts \
        apps/rest-api/__tests__/diary-distill.test.ts
git commit -m "feat(rest-api): add consolidate and compile endpoints to diary-distill routes"
```

---

## Task 7: Wire workflows into bootstrap + export `estimateTokens`

**Files:**

- Modify: `apps/rest-api/src/bootstrap.ts`
- Modify: `libs/context-distill/src/index.ts`

**Step 1: Check `context-distill/src/index.ts`**

```bash
cat libs/context-distill/src/index.ts
```

If `estimateTokens` is not exported, add:

```typescript
export { estimateTokens } from './compress.js';
```

**Step 2: Check `bootstrap.ts`**

```bash
cat apps/rest-api/src/bootstrap.ts
```

Find where `initDiaryWorkflows()` and `setDiaryWorkflowDeps()` are called. Add `initContextDistillWorkflows` and `setContextDistillDeps` in the same place:

```typescript
import {
  initContextDistillWorkflows,
  setContextDistillDeps,
} from './workflows/context-distill-workflows.js';

// After initDiaryWorkflows() call:
initContextDistillWorkflows();

// After setDiaryWorkflowDeps() call:
setContextDistillDeps({
  diaryEntryRepository,
  embeddingService,
});
```

**Step 3: Run typecheck across all workspaces**

```bash
pnpm run typecheck
```

**Step 4: Run all tests**

```bash
pnpm run test
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add apps/rest-api/src/bootstrap.ts \
        libs/context-distill/src/index.ts
git commit -m "feat(rest-api): wire context-distill workflows into bootstrap"
```

---

## Task 8: Regenerate api-client and final validation

**Files:**

- Modify: `libs/api-client/src/` (generated)

**Step 1: Generate OpenAPI spec**

```bash
pnpm run generate:openapi
```

**Step 2: Verify new operations appear in the spec**

```bash
grep -A 5 'consolidateDiary\|compileDiary' openapi.json
```

Expected: both `consolidateDiary` and `compileDiary` operations present.

**Step 3: Run full validation**

```bash
pnpm run validate
```

Expected: lint + typecheck + test + build all pass.

**Step 4: Commit**

```bash
git add libs/api-client/src/ openapi.json
git commit -m "feat(api-client): regenerate client with consolidate and compile endpoints"
```

---

## Task 9: Write journal entry and create PR

**Step 1: Write handoff journal entry**

```bash
# Follow docs/BUILDER_JOURNAL.md format
# File: docs/journal/2026-03-05-02-context-distill-phase2.md
# Type: handoff
# Include: route split, new repository method, DBOS queue pattern, dedup key design
```

**Step 2: Update journal README**

Add row to `docs/journal/README.md` index table.

**Step 3: Run `/handoff` skill**

Use the `/handoff` slash command to create the PR with the Mission Integrity checklist.
