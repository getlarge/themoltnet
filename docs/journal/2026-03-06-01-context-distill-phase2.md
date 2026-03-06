---
date: '2026-03-06T14:25:00Z'
author: claude-sonnet-4-6
session: feat/context-distill-phase2
type: handoff
importance: 0.8
tags: [context-distill, dbos, workflows, openapi, prettier, phase2]
supersedes: null
signature: pending
---

# Context Distill Phase 2 — DBOS Workflows + API Endpoints

## Context

Implementing Phase 2 of the context-distill workstream (issue #325 / PR #373). Phase 1 built `@moltnet/context-distill` library. Phase 2 wires it into the REST API as DBOS WorkflowQueue workflows with per-agent concurrency and deduplication, exposed via two new endpoints.

## Substance

### What was done

**Task 1–2: Route split** — `apps/rest-api/src/routes/diary.ts` split into three files:

- `diary.ts` — diary CRUD only
- `diary-entries.ts` — entry CRUD only
- `diary-distill.ts` — reflect + consolidate + compile

**Task 3: `fetchEmbeddings`** — added to `DiaryEntryRepository` in `libs/database/src/repositories/diary-entry.repository.ts`. Separate SELECT fetching only `id` and `embedding` columns — avoids loading content/metadata for embedding-only operations.

**Task 4: TypeBox schemas** — `ConsolidateResultSchema`, `CompileResultSchema`, `ClusterSchema`, `DistillEntryRefSchema`, `CompiledEntrySchema` added to `apps/rest-api/src/schemas.ts` and registered in `sharedSchemas`.

**Task 5: DBOS workflows** — `apps/rest-api/src/workflows/context-distill-workflows.ts`:

- Two `WorkflowQueue`s: `consolidateQueue` (concurrency 1, partitioned) and `compileQueue` (concurrency 5, partitioned)
- Partition key: `identityId` — per-agent concurrency isolation
- Steps: `fetchEntriesStep`, `fetchEmbeddingsStep`, `embedQueryStep`, `searchEntriesStep`
- Lazy init pattern: `initContextDistillWorkflows()` + `setContextDistillDeps()`

**Task 6: Routes** — `POST /diaries/:id/consolidate` and `POST /diaries/:id/compile` added to `diary-distill.ts`:

- Both verify diary ownership via `diaryService.findDiary()`
- Consolidate dedup key: hash of entry IDs (or tags/threshold/strategy if no IDs specified)
- Compile dedup key: SHA256(`${diaryId}:${promptHash}:budget:${budget}:lambda:...:state:${latestEntry.updatedAt}`) — content-hash dedup using latest entry `updatedAt` as state signal
- DBOS enqueue pattern: `DBOS.startWorkflow(fn, { queueName, enqueueOptions: { deduplicationID, queuePartitionKey: identityId } })(input)` → `handle.getResult()`

**Task 7: Bootstrap wiring** — `initContextDistillWorkflows()` added to `registerWorkflows[]`, `setContextDistillDeps({ diaryEntryRepository, embeddingService })` to `afterLaunch[]`.

**Task 8: OpenAPI + clients** — regenerated `openapi.json`, TS `api-client`, Go `api-client` with new endpoints.

**Bonus: prettier-plugin-sort-json** — added to fix CI OpenAPI Spec job failure. Root cause: `generate:openapi` writes `JSON.stringify` output (no stable key order), but the full `generate` script runs prettier after — and prettier's output wasn't committed. Added `prettier-plugin-sort-json@4.2.0` with `jsonRecursiveSort: true` to `.prettierrc.json` for deterministic ordering. Also fixed `cmd/moltnet-api-client/cmd/normalize-spec/main.go` to use a `sortedMap` type with sorted-key JSON marshaling. Ran `pnpm run format` to reformat all 89 JSON files.

**Tests** — 253 tests pass in rest-api, all workspace tests pass (1065+ total). Mock pattern for DBOS: `vi.hoisted` + `vi.mock('@moltnet/database', async (importOriginal) => ({ ...original, DBOS: { startWorkflow: mockStartWorkflow } }))`.

**No dynamic imports in tests** — banned in `CLAUDE.md`/`AGENTS.md`. Only legitimate for UI lazy loading and `vi.resetModules()` lifecycle tests.

### Key design decisions

**Compile dedup strategy (Option 3: content-hash with state signal)**: dedup key includes `latestEntry.updatedAt` as diary state signal. This means the same compile request won't get stale cached results when diary content changes. The route calls `diaryEntryRepository.list({ diaryId, limit: 1 })` to fetch the latest entry before enqueuing.

**`partitionQueue` vs `deduplicationID`**: partition key controls per-agent concurrency (at most N workflows per agent at once); dedup ID controls idempotency (same logical operation returns cached result). These are orthogonal.

**Step param typing**: DBOS infers `unknown` for default parameters (`limit = 500`). Changed to explicit annotation `limit: number` to avoid TS2322.

## Continuity Notes

### Current state

- Branch: `feat/context-distill-phase2`
- All commits pushed to `origin/feat/context-distill-phase2`
- PR #373 exists as draft — needs to be marked ready for review
- CI last run failed on OpenAPI Spec job (fixed in `d76ddc9` commit)
- CI should pass now — wait for next run to confirm

### Git log (top commits)

```
d76ddc9 chore: add prettier-plugin-sort-json and regenerate all JSON/API clients
e5d8eb5 docs(agents): ban dynamic imports in tests, document legitimate exceptions
a435b77 feat(rest-api): regenerate OpenAPI spec with consolidate and compile endpoints
264a78f feat(rest-api): wire context-distill workflows into bootstrap
3d4c2e2 feat(rest-api): add consolidate and compile endpoints to diary-distill routes
5691e31 feat(rest-api): add consolidateWorkflow and compileWorkflow DBOS workflows
6c9c330 feat(rest-api): add ConsolidateResult and CompileResult TypeBox schemas
d09dca3 feat(database): add fetchEmbeddings to diary-entry repository
fef977f refactor(rest-api): move reflect to diary-distill route file
89689c8 refactor(rest-api): split diary routes into diary + diary-entries
```

### What's not done

- PR #373 still draft — mark ready for review
- Journal index (`docs/journal/README.md`) needs this entry added
- No e2e tests for consolidate/compile endpoints (they require a running DBOS + embedding model)

### Where to start next

1. Mark PR #373 as ready for review
2. Update `docs/journal/README.md` to add this entry
3. Monitor CI — if the OpenAPI Spec job still fails, check if `openapi-normalized.json` also needs committing (it's in `.gitignore` or generated on-the-fly)
4. After merge, Phase 3: MCP tools for consolidate/compile, and LeGreffier skill integration
