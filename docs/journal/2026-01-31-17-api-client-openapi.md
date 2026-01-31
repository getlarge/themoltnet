---
date: '2026-01-31T11:30:00Z'
author: claude-opus-4-5-20251101
session: plan-api-implementation-r3cDQ
type: handoff
importance: 0.8
tags: [openapi, api-client, rest-api, mcp-server, code-generation, ci]
supersedes: null
signature: <pending>
---

# API Client Generation & MCP Server Migration

## What was done

### OpenAPI spec generation (REST API)

- Added `@fastify/swagger` to REST API with OpenAPI 3.1 configuration
- Created shared TypeBox response schemas in `apps/rest-api/src/schemas.ts`
- Added `operationId`, `tags`, `description`, and response schemas to all 13 routes
- Created `apps/rest-api/scripts/generate-openapi.ts` for spec extraction via stub services

### Typed API client (`libs/api-client`)

- New workspace using `@hey-api/openapi-ts` with fetch runtime
- Generated typed SDK from OpenAPI spec (13 endpoints, 15 schemas)
- Public entry point re-exports all functions, types, and client utilities
- Root `package.json` has `generate:openapi`, `generate:client`, and `generate` scripts

### MCP server migration

- Replaced hand-written `ApiClient` class with generated SDK functions
- All tool handlers now use typed SDK calls (e.g., `createDiaryEntry({ client, auth, body })`)
- Deleted `apps/mcp-server/src/api-client.ts`
- All 6 test files rewritten to mock SDK functions directly via `vi.mock('@moltnet/api-client')`

### CI: OpenAPI freshness check

- Added `openapi` job to CI that regenerates spec + client and checks for uncommitted changes
- Ensures route changes always produce matching generated code

### Rebase & pnpm migration

- Rebased onto main (pnpm migration, design system, coordination framework)
- Converted all new package.json files to use pnpm `catalog:` references
- Added new deps to `pnpm-workspace.yaml` catalog (ory/client, fastify/swagger, MCP SDK, hey-api)
- Fixed design-system and api-client test scripts to use `vitest run` (not watch mode)

## Test results

- 305 tests passing across 11 workspaces
- MCP server: 46 tests, REST API: 32 tests
- All workspaces build cleanly
- Lint: 0 errors

## Decisions made

- **SDK function mocking**: Tests mock at SDK function level, not HTTP client internals
- **workspace:\* for internal deps**: `@moltnet/api-client` uses `workspace:*` in mcp-server
- **Separate CI job for OpenAPI**: Runs in parallel with lint/typecheck/test, not blocking build

## What's next

- Phase 5: Docker Compose for local testing with Ory services, Dockerfiles per app
- Phase 6: E2E tests using the auto-generated client
- Consider adding Swagger UI endpoint for development
