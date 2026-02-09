---
date: '2026-02-09T20:00:00Z'
author: claude-opus-4-6
session: edouard-1770665143
type: handoff
importance: 0.6
tags: [handoff, deploy, ci, fly-io, mcp-server, ws7]
supersedes: null
signature: pending
---

# Handoff: MCP Server Fly.io Deployment Config

## What Was Done This Session

1. **Created issue #139** — full deployment plan for MCP server on Fly.io
2. **Created `apps/mcp-server/fly.toml`** — Fly.io config for `moltnet-mcp` app at `mcp.themolt.net`
   - SSE-optimized: `auto_stop_machines = "suspend"`, `concurrency.type = "connections"`
   - Port 8001, health check at `/healthz`
   - `MCP_RESOURCE_URI = "https://mcp.themolt.net"`
3. **Refactored deploy workflows into reusable pattern**:
   - `.github/workflows/_deploy.yml` — reusable workflow with inputs for `fly-app`, `image-name`, `dockerfile`, `working-directory`, `deploy`
   - `.github/workflows/deploy.yml` — server caller with preflight secret check
   - `.github/workflows/deploy-mcp.yml` — MCP server caller with preflight secret check
4. **Extended preflight secret check** to support both apps:
   - `check-secrets.ts` now accepts `--app` (rest-api | mcp-server) and `--fly-toml` flags via `node:util/parseArgs`
   - Uses `smol-toml` to parse fly.toml `[env]` keys — merges with `flyctl secrets list` so the check covers both sources
   - Exported `McpServerConfigSchema` and `getRequiredSecrets()` from `@moltnet/mcp-server`
5. **Added explicit `permissions` blocks** to caller workflows (CodeQL finding)

## What's Not Done Yet

- `flyctl apps create moltnet-mcp` — manual step, needs Fly.io access
- `flyctl secrets set -a moltnet-mcp ORY_PROJECT_API_KEY=...` — manual step
- `flyctl certs add -a moltnet-mcp mcp.themolt.net` + DNS CNAME — manual step
- Verify deploy via `workflow_dispatch` trigger
- Update `docs/INFRASTRUCTURE.md` with MCP server deployment details

## Current State

- **Branch**: `claude/139-deploy-mcp-server` (from latest `main`)
- **Files changed**: 12 files (+369/-82)
- **Tests**: No new tests (CI/deployment config + lightweight CLI tooling)
- **Build**: CI passes (lint, typecheck, test, build, E2E)

## Decisions Made

1. **Separate Fly.io app** (`moltnet-mcp`) rather than subpath on existing server — different ports, transports, scaling needs
2. **Reusable workflow** (`_deploy.yml`) instead of duplicating — ~90% shared between server and MCP deploy jobs
3. **Preflight checks both sources** — `flyctl secrets list` + `fly.toml` `[env]` keys, merged before comparison against schema-derived required vars
4. **`smol-toml` for TOML parsing** — already a transitive dep, zero-dep, avoids fragile awk/sed shell parsing
5. **`node:util/parseArgs`** for CLI arg handling — stdlib, no extra deps
6. **`suspend` not `stop`** for auto_stop — SSE connections are long-lived, killing them breaks MCP clients
7. **`connections` not `requests`** for concurrency — SSE is 1 connection with many messages
8. **Domain**: `mcp.themolt.net` (confirmed by human)

## Open Questions

- Should `min_machines_running` be 1 to avoid cold starts for MCP clients?

## Where to Start Next

1. Review and merge PR #140
2. Run the manual Fly.io setup steps (create app, set secrets, add cert)
3. Trigger first deploy via `workflow_dispatch`
4. Verify health check and SSE connectivity
