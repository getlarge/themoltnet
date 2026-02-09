---
date: '2026-02-08T15:30:00Z'
author: claude-opus-4-6
session: unknown
type: handoff
importance: 0.7
tags: [handoff, mcp-auth-proxy, auth, oauth2, fastify-plugin]
supersedes: null
signature: pending
---

# Handoff: @moltnet/mcp-auth-proxy Plugin

## What Was Done This Session

- Created `libs/mcp-auth-proxy` — a Fastify plugin that transparently exchanges `X-Client-Id` + `X-Client-Secret` headers for OAuth2 bearer tokens via client_credentials flow against Ory Hydra
- Implemented `MemoryTokenCache` with lazy eviction, `TokenCache` interface exported for future Redis backend
- Implemented `discoverTokenEndpoint()` for OIDC `.well-known/openid-configuration` discovery at startup
- Implemented `createTokenExchanger()` with concurrent request deduplication, in-memory rate limiting, and configurable early token refresh
- Implemented the Fastify `onRequest` hook plugin with passthrough for existing auth, error mapping (401/429/502), and credential header stripping
- Added `x-client-id` and `x-client-secret` to `DEFAULT_REDACT_PATHS` in `@moltnet/observability`
- Added `libs/mcp-auth-proxy` to `knip.config.ts`
- 35 tests across 3 test files, all passing
- Full `pnpm run validate` passes (lint, typecheck, test, build)

## What's Not Done Yet

- Integration with `apps/mcp-server` — the plugin needs to be registered in the MCP server app
- `RedisTokenCache` — the `TokenCache` interface is exported but only `MemoryTokenCache` is implemented (Redis deferred since `ioredis` isn't in the catalog and single Fly.io instance doesn't need it)
- E2E tests against real Ory Hydra (unit tests mock `fetch`)

## Current State

- Branch: `claude/125-mcp-auth-proxy`
- Worktree: `/Users/edouard/Dev/getlarge/themoltnet-125-mcp-auth-proxy`
- Tests: 35 passing, 0 failing (590 total across monorepo)
- Build: clean
- Lint: 0 errors (warnings only — pre-existing across repo)

## Decisions Made

- **No `@moltnet/observability` dependency** — Uses `fastify.log` like the auth lib. Added redact paths as defense-in-depth.
- **Native `fetch`** — Node 22+ is the target. No HTTP client dependency for a simple `POST /oauth2/token`.
- **In-memory rate limiting** — `Map<string, { failures, cooldownUntil }>`. Default: 5 failures -> 60s cooldown. Reset on success. Sufficient for single-instance deployment.
- **OIDC discovery at registration time** — Fail fast if discovery fails. Token endpoint is resolved once, not per-request.
- **Concurrent dedup via `inFlight` Map** — Multiple parallel requests for the same clientId share one exchange promise, preventing thundering herd on cache miss.

## Open Questions

- Should the MCP server register this plugin unconditionally, or make it configurable via env var (e.g., `ENABLE_CLIENT_CREDENTIALS_PROXY=true`)?
- When integrating with `@getlarge/fastify-mcp`, does the plugin need to run before or after any MCP-specific hooks?

## Where to Start Next

1. Read this handoff entry
2. Read `docs/plans/2026-02-08-mcp-auth-proxy-design.md` for the full design context
3. Register `mcpAuthProxyPlugin` in `apps/mcp-server/src/app.ts`
4. Add `@moltnet/mcp-auth-proxy` as a dependency of `apps/mcp-server`
5. Test the integration with a real Ory Hydra instance
