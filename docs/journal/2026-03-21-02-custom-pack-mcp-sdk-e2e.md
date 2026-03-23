---
date: '2026-03-21T14:58:00Z'
author: codex-gpt-5
session: feat/issue-456-custom-packs
type: handoff
importance: 0.8
tags:
  [handoff, mcp-server, context-packs, custom-packs, openapi, e2e, issue-456]
supersedes: null
signature: pending
---

# Custom Pack MCP Tools, Generated Clients, and E2E Coverage

## Context

Follow-up pass for issue #456 after the REST API-only implementation. The goal
was to expose custom pack preview/create through the MCP server, regenerate the
OpenAPI-derived clients, and prove the end-to-end behavior with authorization
checks and an Ax-style client-side selection flow.

## Substance

### What was done

- Regenerated `apps/rest-api/public/openapi.json`.
- Regenerated the TypeScript API client under `libs/api-client/src/generated/`.
- Regenerated the Go client under `cmd/moltnet-api-client/`.
- Added MCP pack tools:
  - `packs_preview`
  - `packs_create`
- Added MCP schemas for explicit custom pack entry selections with snake-case
  inputs (`entry_id`, `token_budget`, `diary_id`).
- Added MCP handler error extraction so REST `ProblemDetails.detail` values are
  surfaced instead of generic fallback errors.
- Extended MCP unit coverage for preview/create success, auth failure, and API
  error propagation.
- Added REST API e2e coverage for:
  - unauthenticated preview
  - cross-agent authorization boundaries
  - invalid mixed-diary selections
  - client-side retrieval/ranking followed by preview/create
- Added MCP e2e coverage for the same custom-pack flow, including a simulated
  Ax-style agent that searches and ranks entries client-side before calling
  `packs_preview` and `packs_create`.
- Extended MCP tool-registry e2e assertions to include the two new tools.
- Refactored the MCP e2e harness to support provisioning a second authenticated
  agent for authorization checks.

### Validation

- `pnpm --filter @moltnet/rest-api run typecheck`
- `pnpm --filter @moltnet/rest-api exec vitest run e2e/custom-packs.e2e.test.ts --config vitest.config.e2e.ts --reporter=verbose`
- `pnpm --filter @moltnet/api-client run typecheck`
- `cd cmd/moltnet-api-client && go test ./...`
- `pnpm --filter @moltnet/mcp-server exec vitest run __tests__/pack-tools.test.ts --reporter=dot`
- `pnpm --filter @moltnet/mcp-server run typecheck`
- `pnpm --filter @moltnet/mcp-server run test:e2e`

### Important operational note

- The MCP e2e target must run outside the sandbox in this environment because
  its global setup probes Docker-published `localhost` ports (`4433`, `4444`,
  `4466`, `8080`, `8001`).
- After changing MCP handler code, the `mcp-server` image must be rebuilt and
  recreated in the Docker e2e stack before rerunning the MCP target, or the
  suite will exercise stale container code.

## Continuity Notes

### Current state

- Branch: `feat/issue-456-custom-packs`
- Worktree:
  `/Users/edouard/Dev/getlarge/themoltnet/.worktrees/issue-456-custom-packs`
- REST API, generated clients, and MCP server are now aligned for custom pack
  preview/create.
- The untracked `.moltnet` symlink in the worktree is local workflow plumbing
  for LeGreffier and should not be committed.

### Where to start next

- Push this branch.
- Open a PR summarizing the two commits:
  - REST API custom pack preview/create
  - MCP tools, generated clients, and e2e coverage
