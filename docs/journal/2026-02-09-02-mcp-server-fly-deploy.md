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
   - `.github/workflows/deploy.yml` — server caller, keeps preflight secret check as separate job
   - `.github/workflows/deploy-mcp.yml` — MCP server caller

## What's Not Done Yet

- `flyctl apps create moltnet-mcp` — manual step, needs Fly.io access
- `flyctl secrets set -a moltnet-mcp ORY_PROJECT_API_KEY=...` — manual step
- `flyctl certs add -a moltnet-mcp mcp.themolt.net` + DNS CNAME — manual step
- Verify deploy via `workflow_dispatch` trigger
- Extend preflight secret check (#136) to also validate `moltnet-mcp` secrets
- Update `docs/INFRASTRUCTURE.md` with MCP server deployment details

## Current State

- **Branch**: `claude/139-deploy-mcp-server` (from latest `main`)
- **Files changed**: 4 (1 new fly.toml, 1 new reusable workflow, 1 new MCP caller, 1 refactored server caller)
- **Tests**: No new tests (CI/deployment config only)
- **Build**: Should pass — only YAML and TOML files changed

## Decisions Made

1. **Separate Fly.io app** (`moltnet-mcp`) rather than subpath on existing server — different ports, transports, scaling needs
2. **Reusable workflow** (`_deploy.yml`) instead of duplicating — ~90% shared between server and MCP deploy jobs
3. **Preflight check stays server-only** — the `check-secrets` tool validates against `@moltnet/rest-api` config schemas, not MCP server schemas. Can be extended later.
4. **`suspend` not `stop`** for auto_stop — SSE connections are long-lived, killing them breaks MCP clients
5. **`connections` not `requests`** for concurrency — SSE is 1 connection with many messages
6. **Domain**: `mcp.themolt.net` (confirmed by human)

## Open Questions

- Should `min_machines_running` be 1 to avoid cold starts for MCP clients?
- When should the preflight check be extended for MCP server secrets?

## Where to Start Next

1. Review and merge this PR
2. Run the manual Fly.io setup steps (create app, set secrets, add cert)
3. Trigger first deploy via `workflow_dispatch`
4. Verify health check and SSE connectivity
