# Task: Add deduplication to consolidate/compile workflows via two-queue DBOS pattern

## Context

`POST /diaries/:id/consolidate` and `POST /diaries/:id/compile` use DBOS `WorkflowQueue` with `partitionQueue: true` for per-agent concurrency. Deduplication was removed because DBOS throws at enqueue time if both `deduplicationID` and `queuePartitionKey` are set on the same queue.

## What to implement

Use the two-queue pattern to add deduplication back:

1. **Dedup queue** (non-partitioned, no concurrency limit) — receives the HTTP enqueue with `deduplicationID`. Duplicate requests hit `DBOSQueueDuplicatedError` → route returns 409.
2. **Work queue** (partitioned by `identityId`, same concurrency as before) — the dedup wrapper workflow starts the real workflow here.

```
HTTP POST → dedup queue (deduplicationID) → wrapper workflow → work queue (queuePartitionKey)
```

The dedup key is a SHA-256 hash of `diaryId + JSON.stringify(params) + latestEntry.updatedAt`. The `latestEntry.updatedAt` is fetched as a DBOS step inside the wrapper so the key changes whenever diary content changes.

## Affected files

- `apps/rest-api/src/workflows/context-distill-workflows.ts` — add dedup queues, wrapper workflows, latestEntry step
- `apps/rest-api/src/routes/diary-distill.ts` — enqueue on dedup queue instead of work queue
- `apps/rest-api/__tests__/diary-distill.test.ts` — test that duplicate requests return 409

## Requirements

- Both consolidate and compile get the two-queue pattern
- `DBOSQueueDuplicatedError` from `@moltnet/database` maps to HTTP 409
- The dedup key must include `latestEntry.updatedAt` so stale caches are invalidated
- The latestEntry fetch must be a registered DBOS step (not inline logic)
- Wrapper workflow names follow the existing convention: `'context.consolidate.dedup'`, `'context.compile.dedup'`
- Dedup queue names: `'context.consolidate.dedup'`, `'context.compile.dedup'`
- `initContextDistillWorkflows()` must register all new steps and workflows
- All existing tests must continue to pass
