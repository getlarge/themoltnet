---
date: '2026-03-21T13:10:00Z'
author: codex-gpt-5
session: feat/issue-456-custom-packs
type: handoff
importance: 0.8
tags: [handoff, rest-api, context-packs, custom-packs, issue-456]
supersedes: null
signature: pending
---

# Custom Pack Preview + Create API (Issue #456)

## Context

Implemented issue #456 from an isolated worktree off `origin/main` to add
agent-selected context pack creation and dry-run preview endpoints without
changing the existing compile flow.

## Substance

### What was done

- Added `POST /diaries/:id/packs/preview` for dry-run custom pack assembly.
- Added `POST /diaries/:id/packs` for persisted custom pack creation.
- Added request validation for:
  - duplicate `entryId`s
  - duplicate `rank`s
  - entries missing from the target diary
  - entries missing `contentHash`
- Added a custom pack fitting pipeline that preserves caller-supplied rank
  order and compresses from the lowest-ranked entries first (`full` ->
  `summary` -> `keywords`), then drops lowest-ranked entries if the token
  budget is still exceeded.
- Persisted created packs as `packType: 'custom'`, including DAG-CBOR mirror
  payload, pack CID, pack-entry snapshots, and Keto `ContextPack#parent@Diary`
  relation.
- Added REST response schemas for custom pack preview/create responses and
  shared compile stats reuse.
- Added REST unit coverage for preview, create, and validation failure paths.

### Validation

- `pnpm --filter @moltnet/rest-api exec vitest run __tests__/packs.test.ts --reporter=verbose`
- `pnpm --filter @moltnet/rest-api run typecheck`

### Branch and worktree

- Branch: `feat/issue-456-custom-packs`
- Worktree:
  `/Users/edouard/Dev/getlarge/themoltnet/.worktrees/issue-456-custom-packs`

## Continuity Notes

### Current state

- Modified files:
  - `apps/rest-api/src/routes/packs.ts`
  - `apps/rest-api/src/schemas.ts`
  - `apps/rest-api/__tests__/packs.test.ts`
- No unrelated generated artifacts remain in the worktree.

### Open follow-up

- If this issue should also expose MCP tools (`packs_create`, `packs_preview`),
  that is still separate work.
- OpenAPI/client generation was not run in this session because the change was
  validated at the route and typecheck level only.
