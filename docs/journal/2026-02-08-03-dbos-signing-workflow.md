---
date: '2026-02-08T18:30:00Z'
author: claude-opus-4-6
session: unknown
type: handoff
importance: 0.8
tags: [dbos, signing, security, crypto, workflow]
supersedes: null
signature: <pending>
---

# DBOS Signing Workflow (Issue #129)

## Context

Implemented a DBOS durable signing workflow so agents can sign messages without sending private keys over the wire. Previously the MCP `crypto_sign` tool accepted the private key as a parameter — a fundamental security violation.

## What Was Done

### Database layer

- `signing_requests` table with status enum (`pending`/`completed`/`expired`)
- `signing-request.repository.ts` — CRUD + list with filters
- `signing-workflows.ts` — DBOS workflow using `setEvent`/`recv`/`send` pattern with configurable timeout, nonce-based replay prevention, lazy registration

### REST API

- Four endpoints under `/crypto/signing-requests` (create, list, get, sign)
- TypeBox schemas, problem types (409 expired/already-completed)
- Routes use `dataSource.runTransaction()` for atomic DB + workflow scheduling
- Authorization via `agentId` field comparison (no Keto — ephemeral single-owner resources)

### MCP server

- Replaced `crypto_sign` with three new tools: `crypto_prepare_signature`, `crypto_submit_signature`, `crypto_signing_status`
- Response includes `signing_payload` field (`message.nonce`) so agents know exactly what to sign

### Diary service refactor

- Made `dataSource` mandatory (removed all fallback paths)
- Single code path: always `dataSource.runTransaction()` + `DBOS.startWorkflow()`
- Merged duplicate test blocks into one unified suite (35 tests)

### API client

- Regenerated OpenAPI spec and typed client with all four signing endpoints

### Tests

- 8 signing-request repository tests
- 7 signing workflow tests
- 11 signing request route tests
- 12 MCP crypto tool tests (updated)
- 35 diary service tests (merged)
- E2E test written (`signing-requests.e2e.test.ts`) but not yet run (Docker Hub unreachable)

### Combined server

- Wired `signingRequestRepository` and `dataSource` in `apps/server/src/app.ts`

## What's Not Done

- **E2E tests not verified** — Docker Hub unreachable during session, `node:22-slim` image can't be pulled. Run `pnpm --filter @moltnet/server test:e2e` when connectivity is restored.
- **Blog post** (Step 14 from plan) — `docs/posts/dbos-async-signing-workflow.md` not written
- **PR not created** — branch pushed, PR creation pending

## Current State

- **Branch**: `claude/129-dbos-signing-workflow` (pushed to origin)
- **8 commits** in logical groups (db, schemas, routes, tests, diary refactor, MCP, api-client, server+e2e)
- **Unit tests**: 442 passed, 0 failed
- **Lint**: 0 errors (only pre-existing warnings)
- **Typecheck**: 0 new errors (only pre-existing `apps/server` WIP issues)
- **Build**: all packages build successfully

## Decisions Made

1. **No Keto for signing requests** — Ephemeral (5-min TTL), single-owner, no sharing. Simple `agentId` field comparison is sufficient. Documented in route file header.
2. **Nonce in signing payload** — Agent signs `message.nonce` (not just `message`) to prevent replay attacks. Workflow verifies the composite payload.
3. **Mandatory dataSource everywhere** — No dual paths. Both diary service and signing routes always use `dataSource.runTransaction()`.
4. **Lazy workflow registration** — Follows `keto-workflows.ts` pattern with setter functions and `initSigningWorkflows()` to avoid circular deps.

## Open Questions

- Should signing requests eventually get a Keto namespace if multi-party signing is added?
- Should the polling loop in the sign endpoint be replaced with an event-driven approach?

## Continuity Notes

Next agent should:

1. Run e2e tests when Docker Hub is accessible
2. Create PR from `claude/129-dbos-signing-workflow` targeting `main`
3. Optionally write the blog post draft
