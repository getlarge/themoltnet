---
date: '2026-02-13T21:45:00Z'
author: claude-opus-4-6
session: unknown
type: handoff
importance: 0.7
tags: [handoff, ws11, mcp, metadata, sdk, cli, landing, docs]
supersedes: null
signature: pending
---

# Handoff: MCP Config Metadata & Transport Update (SSE → HTTP)

## What Was Done This Session

- Updated MCP transport from SSE to HTTP (`type: "http"`) across the entire codebase
- Added machine-readable agent discovery metadata to the landing page (meta tags, `.well-known/moltnet.json` v0.3.0, `<noscript>` fallback for bots)
- Rewrote `GetStarted.tsx` with a three-step quickstart (Install → Register → Connect MCP), properly separating SDK (Node.js library) from CLI (binary)
- Updated `libs/sdk/src/register.ts`: `McpConfig` interface now uses `type: 'http'` with `headers` (X-Client-Id, X-Client-Secret) instead of `transport: 'sse'`
- Updated `cmd/moltnet/config.go`: `BuildMcpConfig` now takes clientID/clientSecret and generates auth headers
- Updated `docs/MCP_SERVER.md`: Connection section with correct config format, auth headers, multiple client paths
- All SDK tests pass (24/24), landing page typechecks

## What's Not Done Yet

- Go tests have a pre-existing `dyld missing LC_UUID` failure on macOS ARM64 — not related to this change
- Other docs that may reference SSE transport (INFRASTRUCTURE.md, etc.) were not audited

## Current State

- Branch: `claude/mcp-config-metadata` (rebased on latest `main`)
- Tests: 24 passing (SDK), 0 failing
- Typecheck: clean (landing, SDK)
- 11 files changed

## Decisions Made

- MCP transport type is `"http"` (not `"sse"` or `"streamable-http"`) — matches the MCP spec for Streamable HTTP transport
- Auth uses `X-Client-Id` / `X-Client-Secret` headers, exchanged for Bearer token by `@moltnet/mcp-auth-proxy`
- `.well-known/moltnet.json` v0.3.0 merges previous duplicate `join`/`quickstart` sections into a single `quickstart`
- SDK and CLI are presented as distinct install paths (not alternatives in the same step)
- `buildMcpConfig` now requires credentials parameter — breaking change for any external callers

## Mission Integrity Assessment

1. **Agent control**: No change — agents still hold their own keys, generate their own MCP config
2. **Offline verifiable**: N/A — metadata and config changes, no new server dependencies
3. **Platform survival**: Improved — config format is standard MCP (works with any MCP client), not vendor-specific
4. **Simplicity**: Yes — single config format, no duplication across clients
5. **Documented**: Yes — MCP_SERVER.md updated, journal entry written

## Where to Start Next

1. Audit remaining docs for stale SSE references
2. Consider adding the public feed UI (WS11) — the `<noscript>` block and `.well-known/moltnet.json` are the bot-facing foundation
3. The Go CLI tests need the macOS ARM64 dyld issue resolved (tracked separately)
