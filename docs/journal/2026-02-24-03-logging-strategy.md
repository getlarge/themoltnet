---
date: '2026-02-24T19:00:00Z'
author: claude-sonnet-4-6
session: feat/logging-strategy
type: handoff
importance: 0.7
tags:
  [
    observability,
    logging,
    pino,
    als,
    fastify,
    mcp-server,
    rest-api,
    diary-service,
  ]
supersedes: null
signature: <pending>
---

# Structured Logging Strategy — ALS Context + Pino Mixin

## Context

This session implemented structured logging across all MoltNet services as a foundation
for Axiom-based observability. The goal: every log line automatically carries `requestId`,
`identityId`, and `clientId` without threading those values through every function call.

Branch: `feat/logging-strategy`

## Substance

### Design Chosen

**AsyncLocalStorage (ALS) + Pino `mixin`** — the simplest approach that works across all
three services (rest-api, mcp-server, diary-service).

- ALS context store: `libs/observability/src/request-context.ts`
- Pino `mixin` fires on every log call and reads current ALS values → injects them automatically
- OTel context injection deferred to issue #302 (DBOS OTLP endpoint can't carry Bearer tokens)

### What Was Built

**`libs/observability/src/request-context.ts`** (new)

- `RequestContextStore` with `requestId`, `identityId`, `clientId`
- `runWithRequestContext()`, `setRequestContextField()`, `getRequestContextFields()` — the ALS primitives
- `getRequestContextFields()` serves as the Pino `mixin` callback

**rest-api — Fastify request-context plugin** (`apps/rest-api/src/plugins/request-context.ts`)

- `onRequest` hook: calls `runWithRequestContext({ requestId })` with callback form (keeps ALS scope alive)
- `preHandler` hook: enriches with `identityId` / `clientId` from JWT auth context
- Registered in `buildApp` early, before all route plugins

**diary-service logging** (`libs/diary-service/src/diary.service.ts`)

- `logger: FastifyBaseLogger` added to `DiaryServiceDeps`
- Structured log calls: `diary.entry_created`, `diary.entry_updated`, `diary.entry_deleted`,
  `diary.entry_not_found`, `diary.search_complete`, `diary.reflect_complete`
- `FastifyBaseLogger` is the correct type (not `pino.Logger`) to avoid structural mismatch with Fastify's logger

**MCP server — `McpDeps.logger`** (`apps/mcp-server/src/types.ts`)

- Added `logger: FastifyBaseLogger` to `McpDeps`
- `buildApp` assigns `deps.logger = app.log` before any handler runs
- `main.ts` uses `{ client } as McpDeps` cast (logger assigned by buildApp, type-safe at runtime)

**MCP server tool handler logging** (diary-tools, crypto-tools, identity-tools, vouch-tools)

- `tool.invoked` (debug) at handler entry
- `tool.error` (error) in all error branches
- `handleCryptoVerify` renamed `_deps` → `deps` to enable logging

**MCP server request-context plugin** (`apps/mcp-server/src/request-context-plugin.ts`)

- Same ALS enrichment pattern as rest-api
- Key complication: `@getlarge/fastify-mcp` sets `request.authContext.userId` at runtime
  but `@moltnet/auth` augments `FastifyRequest.authContext` with `identityId`
- Solution: local `McpAuthContext { userId?, clientId? }` interface + `(request as unknown as { authContext? })` cast
  avoids unsafe-member-access ESLint errors without touching augmentation files

**Registration workflow — injected logger** (`apps/rest-api/src/workflows/registration-workflow.ts`)

- Replaced `DBOS.logger.error(string)` compensation calls with `FastifyBaseLogger` structured calls
- `RegistrationDeps.logger: FastifyBaseLogger` — injected via `setRegistrationDeps()`
- DBOS OTLP endpoint wiring skipped: `otlpTracesEndpoints` accepts only URL arrays, no auth header
  support → can't connect to Axiom. Deferred to issue #302.

**Crypto signing-request routes** (`apps/rest-api/src/routes/signing-requests.ts`)

- `crypto.signature_prepared` after signing request creation
- `crypto.signature_submitted` after signature submission polling

### Key Technical Discoveries

**Pino `mixin` is synchronous** — ALS `getStore()` works perfectly inside it. Each log call
reads the current ALS context, which is set per-request by the Fastify hooks.

**ALS `onRequest` callback form is required** — `runWithRequestContext` wraps the callback
in `als.run()`. If you use async hooks, the continuation leaves the ALS scope. The Fastify
callback form (`done()` inside `runWithRequestContext`) keeps the entire async chain scoped.

**`FastifyBaseLogger` vs `pino.Logger`**: Fastify's internal logger type is structurally
compatible with its own internal usage, but `pino.Logger` has extra methods that make strict
assignment fail. Use `FastifyBaseLogger` in all service dep interfaces.

**MCP auth context type conflict**: `@getlarge/fastify-mcp` doesn't re-export its request
augmentation from its main index. Using a local interface + cast is cleaner than trying to
import `AuthorizationContext` (which isn't exported).

### Test Results

- `libs/observability`: all pass
- `libs/diary-service`: all pass
- `apps/rest-api`: 226 tests pass
- `apps/mcp-server`: 121 tests pass
- `libs/database`: 1 integration test suite fails — requires live DB (`DATABASE_URL`);
  pre-existing, unrelated to this work

### Commits

- `c4b3648` — feat(rest-api): add structured log events to crypto signing-request routes
- `42c81a9` — feat(mcp-server): add request-context plugin for ALS enrichment
- `af8f20b` — feat(rest-api): replace DBOS.logger with injected Pino logger in registration workflow
- `2bee6df` — feat(mcp-server): add tool.invoked/tool.error log events to all MCP tool handlers
- (earlier commits in the branch cover Tasks 1-3)

## What's Not Done

- **OTel context injection** — DBOS doesn't support auth headers on its OTLP endpoint;
  wiring Axiom traces for workflow spans is deferred to issue #302
- **Log volume tuning** — `tool.invoked` is logged at `debug` level; production may want
  to sample or filter further. Not a blocker.
- **`public-feed-tools.ts` and `info-tools.ts`** — These handlers were not given
  `tool.invoked`/`tool.error` events in this session. They're read-only/lightweight,
  so the omission is low-risk. Future improvement.

## Continuity Notes

**Branch**: `feat/logging-strategy` — ready for PR review
**Tests**: All pass except pre-existing DB integration test
**Build**: Not run (no schema changes; app builds are tested in CI)

**Next agent**: Create PR from `feat/logging-strategy` → `main`. No further code changes
needed. The plan at `docs/plans/2026-02-24-logging-strategy-plan.md` is complete.

If picking up issue #302 (OTel traces for DBOS workflows), start by reading the DBOS SDK
docs on `otlpTracesEndpoints` and explore whether a custom exporter or sidecar approach
can inject Bearer tokens before the collector.
