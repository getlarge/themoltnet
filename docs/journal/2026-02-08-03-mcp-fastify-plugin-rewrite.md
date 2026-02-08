---
date: '2026-02-08T15:55:00Z'
author: claude-opus-4-6
session: unknown
type: handoff
importance: 0.9
tags: [handoff, ws5, mcp-server, fastify-mcp, oauth2, typebox]
supersedes: null
signature: pending
---

# Handoff: MCP Server Rewrite to @getlarge/fastify-mcp

## What Was Done This Session

- **Complete rewrite** of `apps/mcp-server/` from raw `@modelcontextprotocol/sdk` to `@getlarge/fastify-mcp` plugin
- **Dependency updates**: Added `@getlarge/fastify-mcp` and `fastify-plugin` to catalog and package.json; removed `zod`; moved `@modelcontextprotocol/sdk` to devDeps; bumped `@sinclair/typebox` from `^0.32.9` to `^0.34.0` across workspace
- **Config migration**: Replaced `ACCESS_TOKEN`/`PRIVATE_KEY` env vars with OAuth2 config (`AUTH_ENABLED`, `ORY_PROJECT_URL`, `ORY_PROJECT_API_KEY`, `MCP_RESOURCE_URI`)
- **Type system overhaul**: Removed `getAccessToken` from `McpDeps`, extracted `HandlerContext` from `ToolHandler` generic (not re-exported from fastify-mcp package index)
- **Schema migration**: All tool input schemas migrated from Zod to TypeBox in new `schemas.ts`
- **Shared utilities**: Extracted `textResult`, `errorResult`, `jsonResource`, `getTokenFromContext` into `utils.ts`
- **App rewrite**: Replaced 106-line manual HTTP handler with fastify-mcp plugin registration, `buildAuthConfig()`, DCR proxy with `cleanDcrResponse()`
- **Deleted `server.ts`**: No longer needed, plugin manages MCP server internally
- **All 5 tool files migrated**: Handler signatures changed from `(deps, args)` to `(args, deps, context)`; registration changed from `server.registerTool()` to `fastify.mcpAddTool()`
- **Crypto redesign**: `crypto_sign` (took `private_key` param) replaced with `crypto_prepare_signature` + `crypto_submit_signature` pattern -- agent signs locally, server only sees the signature
- **Resources migrated**: Changed from `server.resource()` to `fastify.mcpAddResource()` with `uriPattern`
- **All 50 unit tests updated and passing**: New `createMockContext()` helper, updated handler call signatures, rewrote `server.test.ts` for `buildApp`, rewrote `crypto-tools.test.ts` for prepare/submit
- **Created issue #129**: DBOS signing workflow for delegating Ed25519 signing to external agents (separate from this PR)

## What's Not Done Yet

- **E2E tests** (plan steps 12-13): Deferred to PR #123. Need rewrite to use `@moltnet/bootstrap` and add auth headers to `StreamableHTTPClientTransport`
- **Crypto signing prompt** (plan step 14): MCP prompt instructing agents how to sign messages locally -- low priority, can be added later
- **Landing page status**: WS5 status unchanged (already marked complete)

## Current State

- Branch: `claude/128-mcp-fastify-plugin`
- Tests: 50 passing, 0 failing (MCP server); full workspace passes
- Typecheck: 15/15 packages pass
- Lint: 0 errors (warnings only, pre-existing)
- Build: all packages build successfully
- Working tree: clean

## Decisions Made

1. **HandlerContext extraction via conditional type**: `@getlarge/fastify-mcp` doesn't re-export `HandlerContext` from its index. Worked around with `type ExtractContext<T> = T extends (params: infer _P, context: infer C) => infer _R ? C : never` applied to `ToolHandler`
2. **TypeBox ^0.34.0 bump**: Required as peer dep by fastify-mcp. No breaking changes across 3 workspace consumers (rest-api, mcp-server, libs/models)
3. **Crypto prepare/submit pattern**: Eliminates private key transmission over the wire. Agent signs locally, MCP server verifies against known public key from REST API
4. **DCR proxy with cleanDcrResponse()**: Claude Code's Zod validation rejects extra fields in DCR responses. The proxy strips non-standard fields before returning
5. **Keep `@modelcontextprotocol/sdk` in devDeps**: Still needed by e2e tests for `StreamableHTTPClientTransport` client

## Open Questions

- Should `@getlarge/fastify-mcp` re-export `HandlerContext`? If so, file an issue upstream
- DBOS signing workflow (#129) -- design is drafted but implementation is separate
- E2E test auth flow: how should the test client obtain OAuth2 tokens? Via `@moltnet/bootstrap` genesis agent flow or direct Hydra grant?

## Where to Start Next

1. Read this handoff entry
2. Tackle E2E tests in PR #123 -- rewrite `e2e/setup.ts` to use `@moltnet/bootstrap`, add auth headers to transport
3. Consider filing upstream issue for `HandlerContext` export in `@getlarge/fastify-mcp`
4. Issue #129 (DBOS signing workflow) is a separate workstream
