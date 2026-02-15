---
date: '2026-02-15T15:00:00Z'
author: claude-opus-4-6
session: moltnet-info-discovery-193
type: handoff
importance: 0.7
tags:
  [handoff, discovery, well-known, mcp, sdk, go-cli, openclaw, ws5, ws6, ws9]
supersedes: null
signature: <pending>
---

# Handoff: moltnet_info Discovery Tool Across All Surfaces

## Context

Agents encountering MoltNet for the first time need a way to discover what the network is and how to join. This PR adds a single canonical discovery endpoint and exposes it through every integration surface.

## What Was Done This Session

- **REST API**: Added `GET /.well-known/moltnet.json` — RFC 8615 well-known URI returning network metadata (name, version, description, capabilities, endpoints, registration info). Unauthenticated, cached with `Cache-Control: public, max-age=3600`.
- **MCP Server**: Added `moltnet_info` tool that delegates to the REST API endpoint. Unauthenticated so new agents can discover the network before registering.
- **SDK**: Added `MoltNet.info()` function in `@moltnet/api-client` — type-safe wrapper around the well-known endpoint.
- **Go CLI**: Added `moltnet info` command with human-readable table output and `--json` flag for raw JSON.
- **OpenClaw**: Added Discovery section to `SKILL.md` referencing the `moltnet_info` tool.

## Decisions Made

- **Embedded constant over file read**: The network info object is a TypeScript constant in `apps/rest-api/src/routes/public.ts` rather than read from a JSON file. This keeps it type-checked and avoids filesystem I/O at runtime.
- **RFC 8615 `.well-known` path**: Following the standard pattern for service discovery. Any HTTP client can `GET /.well-known/moltnet.json` without auth.
- **Unauthenticated access**: Discovery must work before an agent has credentials — this is the bootstrap entry point.

## Current State

- Branch: `claude/moltnet-info-discovery`
- PR: #193
- All 15 files changed, 1455 lines added
- `pnpm run typecheck` passes
- `pnpm run lint` passes
- `pnpm run test` passes

## What's Not Done Yet

- E2E test for the `.well-known/moltnet.json` endpoint (would need Docker Compose)
- Keeping the `NetworkInfo` constant in sync with landing page copy when either changes

## Where to Start Next

1. Merge this PR after CI passes
2. Consider adding an E2E test that hits the well-known endpoint in the Docker Compose test suite
3. If landing page copy changes, update the `NETWORK_INFO` constant in `apps/rest-api/src/routes/public.ts`
