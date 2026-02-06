---
date: '2026-02-06T11:00:00Z'
author: claude-opus-4-6
session: unknown
type: handoff
importance: 0.7
tags: [docker, security, mcp-server, deployment, ws7]
supersedes: null
signature: pending
---

# Handoff: Harden Docker Images (Issue #77)

## What Was Done This Session

- Removed `ARG NPM_STRICT_SSL` and `npm config set strict-ssl` from all Dockerfiles (server, mcp-server, landing)
- Upgraded mcp-server and landing base images from `node:20-slim` to `node:22-slim`
- Rewrote `apps/mcp-server/Dockerfile` to use `pnpm deploy --legacy --prod` pattern (matching server Dockerfile)
- Created MCP server HTTP entry point: `config.ts`, `app.ts`, `main.ts` — Fastify app with `/healthz` health check and `/mcp` POST/GET/DELETE routes using `StreamableHTTPServerTransport`
- Deleted `apps/rest-api/Dockerfile` (combined server handles deployment)
- Updated `docker-compose.yaml`: replaced `rest-api` service with `server` service, fixed mcp-server dependencies, updated healthchecks to use `node -e fetch(...)` instead of `wget`
- Fixed pre-existing issue: added `mailslurper` to `ci` profile (kratos depends on it but it was `dev`-only)

## What's Not Done Yet

- No tests for the new `app.ts` / `config.ts` / `main.ts` files (unit tests for the MCP HTTP layer)
- Docker Compose `ci` profile not tested end-to-end with full infrastructure (requires Ory services)
- Landing Dockerfile doesn't use `pnpm deploy --prod` (it's nginx-based, so the build stage is discarded anyway)

## Current State

- Branch: `claude/harden-docker-images`
- Tests: 449 passing, 0 failing (`pnpm run validate` clean)
- Docker builds: all 3 images build and start successfully
- Image sizes: server 259MB (was 564MB), mcp-server 268MB (was ~963MB), landing 62MB
- MCP server responds to JSON-RPC initialize on `/mcp`

## Decisions Made

- **MCP server uses Fastify, not Express**: The SDK example uses Express, but the rest of the codebase uses Fastify. Adapted the pattern to use `request.raw`/`reply.raw` to pass Node.js native types to `StreamableHTTPServerTransport.handleRequest()`
- **One McpServer per session**: Each initialize request creates a fresh `createMcpServer(deps)` + `StreamableHTTPServerTransport` pair, stored in a `Map<string, transport>` keyed by session ID. Cleanup happens via `transport.onclose` and the Fastify `onClose` hook.
- **REST API URL points to combined server**: In docker-compose, `mcp-server` connects to `server:8080` instead of a separate `rest-api` service. The combined server serves both the landing page and the API.
- **Healthchecks use `node -e fetch(...)`**: The `node:22-slim` image doesn't include `wget` or `curl`. Using Node's built-in `fetch` for Docker HEALTHCHECK commands.

## Open Questions

- Should the MCP server support multiple concurrent McpServer instances per process, or is one-per-session the right model?
- Should `apps/rest-api` get its own Dockerfile back if standalone API deployment is ever needed?

## Where to Start Next

1. Read this handoff entry
2. Consider adding unit tests for `apps/mcp-server/src/app.ts` (health check, MCP initialize flow)
3. Test `docker compose --profile ci up` with full infrastructure when Ory services are available
4. Check Issue #77 for any remaining requirements
