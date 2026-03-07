---
date: '2026-03-06T22:10:29Z'
author: codex-gpt-5
session: feat/issue-377-379-entry-centric-sdk
type: handoff
importance: 0.8
tags: [handoff, rest-api, sdk, api-client, go-client, entry-centric, distill]
supersedes: null
signature: pending
---

# Entry-Centric Routes + SDK Distill Surface (Issues #377 + #379)

## Context

Implemented issue #377 (entry-centric diary-entry routes with deprecation
bridge) and issue #379 (SDK high-level diary distill methods) in a single
coordinated change set to keep server, OpenAPI, TS client, Go client, SDK, and
tests aligned.

## Substance

### What was done

- Added entry-centric REST endpoints:
  - `GET /entries/:entryId`
  - `PATCH /entries/:entryId`
  - `DELETE /entries/:entryId`
  - `GET /entries/:entryId/verify`
- Kept nested routes (`/diaries/:diaryId/entries/:entryId*`) as aliases and
  marked them deprecated in OpenAPI.
- Refactored diary service entry operations to be entry-id first, with optional
  diary scoping for alias routes.
- Regenerated API specs/clients:
  - `apps/rest-api/public/openapi.json`
  - `libs/api-client/src/generated/*`
  - `cmd/moltnet-api-client/oas_*_gen.go`
- Updated SDK (`libs/sdk/src/agent.ts`):
  - Added `diaries.consolidate(...)`
  - Added `diaries.compile(...)`
  - Switched `entries.get/update/delete/verify` internals to entry-centric API
  - Added explicit `entries.getById/updateById/deleteById/verifyById`
- Extended tests:
  - REST unit: `apps/rest-api/__tests__/diary-entries.test.ts`
  - REST e2e: `apps/rest-api/e2e/diary-crud.e2e.test.ts`
  - SDK unit: `libs/sdk/__tests__/agent.test.ts`

### Validation

- `pnpm run generate`
- `pnpm run go:generate`
- `pnpm --filter @moltnet/rest-api test -- __tests__/diary-entries.test.ts`
- `pnpm --filter @themoltnet/sdk test -- __tests__/agent.test.ts`
- `pnpm --filter @moltnet/rest-api typecheck`
- `pnpm --filter @themoltnet/sdk typecheck`
- `pnpm run go:test`

### Branch and commit

- Branch: `feat/issue-377-379-entry-centric-sdk`
- Main feature commit:
  - `2e93622 feat(api): add entry-centric entry routes and distill sdk facade`
  - includes diary link: `MoltNet-Diary: 7d37018b-f99d-4fae-a7bb-23a307d93bd8`

## Continuity Notes

### Current state

- `main` was reset back to `origin/main` after an accidental direct commit.
- Work is preserved on `feat/issue-377-379-entry-centric-sdk`.
- Working tree has two unrelated untracked local files:
  - `Diary`
  - `cmd/moltnet-api-client/normalize-spec`

### Open follow-up

- Open PR from `feat/issue-377-379-entry-centric-sdk` to `main`, closing
  `#377` and `#379`.
- In review, call out that nested routes are intentionally deprecated aliases
  (non-breaking migration window).
