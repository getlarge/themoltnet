---
date: '2026-02-08T19:30:00Z'
author: claude-opus-4-6
session: unknown
type: handoff
importance: 0.7
tags: [handoff, ws5, mcp-server, e2e, testing, auth-proxy]
supersedes: null
signature: pending
---

# Handoff: MCP Server E2E Tests & Vouch Unit Tests

## What Was Done This Session

- Reworked PR #123 (`claude/mcp-server-tests-115`) after MCP server rewrite (PR #132) and auth proxy merge (PR #131)
- Reset branch to main and rebuilt all test infrastructure from scratch
- Created 10 vouch-tools unit tests (`__tests__/vouch-tools.test.ts`) for `handleIssueVoucher`, `handleListVouchers`, `handleTrustGraph`
- Created full e2e test infrastructure running all services in Docker:
  - `e2e/globalSetup.ts` — Docker Compose lifecycle (down → up --build → wait for 5 services)
  - `e2e/setup.ts` — Test harness using `@moltnet/bootstrap` to create genesis agent with Ory admin APIs
  - `e2e/mcp-server.e2e.test.ts` — 16 e2e tests covering healthz, SDK client (tools, resources, templates), identity, diary CRUD, crypto, vouch, raw HTTP error cases, session lifecycle
  - `vitest.config.e2e.ts` — Separate vitest config for e2e with 30s/120s timeouts
- Auth uses `X-Client-Id` / `X-Client-Secret` headers via `@moltnet/mcp-auth-proxy` (not pre-acquired Bearer tokens)
- Added `mcp-server` service to `docker-compose.e2e.yaml` with `CLIENT_CREDENTIALS_PROXY: 'true'`
- Updated `Dockerfile` to include `libs/bootstrap/package.json` for Docker builds
- Added `test:e2e` script, devDeps (`@moltnet/bootstrap`, `@moltnet/database`, `drizzle-orm`) to package.json
- Addressed all PR review comments from Copilot (hardcoded URL fixed, version assertion relaxed to semver regex)

## What's Not Done Yet

- E2e tests not yet executed against real Docker infrastructure (only unit tests run — e2e requires Docker Compose up)
- No `docs/AUTH_FLOW.md` rewrite (was in original PR but removed since architecture changed significantly)
- `docker-compose.base.yaml` healthcheck fix (`/health` → `/healthz`) — not needed since e2e yaml defines its own mcp-server service

## Current State

- Branch: `claude/mcp-server-tests-115`
- Unit tests: 573 passing across full workspace (62 in mcp-server)
- Typecheck: clean
- Lint: clean (no errors, only pre-existing warnings)
- Build: all 17 workspaces build successfully
- Branch is at origin/main HEAD with only unstaged/untracked changes (no commits yet)

## Decisions Made

- **Docker-only e2e**: MCP server runs in Docker container, not in-process. This validates the Dockerfile and deployment config
- **Client credentials via headers**: Tests use `X-Client-Id`/`X-Client-Secret` headers instead of pre-acquired Bearer tokens. The mcp-auth-proxy plugin exchanges these for tokens via Hydra
- **Direct REST API test keeps Bearer**: The REST API at :8080 doesn't have the auth proxy, so the single direct REST API sanity check still uses `Authorization: Bearer`
- **tsconfig references auto-synced**: `update-ts-references` manages references from `workspace:*` deps; manual curation not needed (Copilot review comment was incorrect)
- **Semver regex for version assertion**: Changed from exact `0.1.0` to `/^\d+\.\d+\.\d+/` per review feedback

## Open Questions

- Should the `test:e2e` script be added to the root `validate` command or remain manual-only? (It requires Docker and takes minutes)
- The direct REST API test uses `harness.agent.accessToken` — if bootstrap stops generating tokens, this test needs updating (could use a separate token exchange)

## Where to Start Next

1. Commit and push the branch
2. Run `pnpm --filter @moltnet/mcp-server test:e2e` against real Docker to validate the full e2e flow
3. Fix any e2e failures (likely response format mismatches between expected and actual tool outputs)
4. Consider adding `AUTH_FLOW.md` update once e2e tests are proven green
