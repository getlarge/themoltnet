---
date: '2026-02-09T18:00:00Z'
author: claude-opus-4-6
session: demo-agent-signing-auth
type: handoff
importance: 0.8
tags: [demo-agent, signing, mcp, auth, e2e, registration, webhook]
supersedes: 2026-02-07-02-mcp-first-demo-agents
signature: pending
---

# Demo Agent Signing, Auth Fixes, and Self-Service Registration

## Context

Continuing PR #124 (`claude/demo-agents`). The demo agent system was architecturally complete but blocked by MCP auth issues and missing self-service registration tests.

## Substance

### MCP Token Extraction Fix

The `getTokenFromContext()` function in `apps/mcp-server/src/utils.ts` was reading `context.authContext?.sessionBoundToken` which is always null — the `@getlarge/fastify-mcp` plugin builds `authContext` without `sessionBoundToken` (the code in `session-auth-prehandler.ts` is dead code, never wired in). Fixed by reading the raw Bearer token from `context.request.headers.authorization` instead. This unblocks `moltnet_whoami` returning `authenticated: true`.

### Bootstrap Schema Resolution

Ory Network uses content-hash-based schema IDs (e.g., `1a16fb34968b...`) not aliases like `moltnet_agent`. Bootstrap was hardcoding `schema_id: 'default'` which failed with "Unable to load or parse the JSON schema". Fixed by fetching the schemas list and matching by `$id` containing "agent".

### Webhook Response Parsing

Updated the after-registration webhook to return `{ identity: { metadata_public: { fingerprint, public_key } } }` instead of `{ success: true }`. With `response.parse: true` in the Kratos config, this allows Kratos to set `metadata_public` on the identity during registration — the fingerprint is then available without an extra DB lookup.

Updated both `infra/ory/kratos/kratos.yaml` (local E2E) and `infra/ory/project.json` (production) to enable `response.parse: true` and `can_interrupt: true` for the registration webhook.

### Self-Service Registration E2E Tests

Added `apps/server/e2e/registration.e2e.test.ts` with 5 tests:

1. Happy path with schema selection and `metadata_public` verification
2. Invalid voucher — webhook interrupts, error message propagates through Kratos
3. Invalid public key — webhook interrupts, ed25519 error propagates
4. Already-used voucher — single-use enforcement
5. Full lifecycle: register → OAuth2 client → REST API lookup by fingerprint

### Signing Utility

`tools/sign.mjs` was already implemented (previous session). Uses Node.js built-in `crypto.sign()` with Ed25519 — zero dependencies. Reads `MOLTNET_PRIVATE_KEY` env var (base64-encoded 32-byte seed), accepts payload via argv or stdin, outputs base64 signature. 5 tests passing.

### Demo Agent Architecture

Complete and ready. Each agent container:

- Connects to MoltNet MCP server via `.mcp.json` with `X-Client-Id`/`X-Client-Secret` headers
- MCP auth proxy exchanges credentials for Bearer token
- `sign.mjs` available at `/opt/demo-agent/scripts/sign.mjs` for local signing
- Allowed tools: `mcp__moltnet__*` + `Bash(node ${SIGN_SCRIPT}:*)`

## Continuity Notes

### Branch State

- **Branch:** `claude/demo-agents` (pushed, 20 commits ahead of main)
- **PR:** #124 — updated with current scope
- **All 85 E2E tests pass** (11 test files)
- **Lint/typecheck:** clean

### What's Done

- MCP token extraction fix (`getTokenFromContext`)
- Bootstrap dynamic schema resolution
- Webhook response parsing with `metadata_public`
- Self-service registration E2E tests (5 tests)
- Signing utility + tests
- Demo agent Dockerfile, launch scripts, personas
- SKILL.md with signing flow documentation

### What's Next

1. Deploy MCP server with token extraction fix to Fly.io
2. Build and test demo agent Docker image (requires `docker/sandbox-templates:claude-code` base image)
3. Run demo agents against live MoltNet infrastructure
4. Consider wrapping the registration webhook in a transaction (TODO in hooks.ts)
