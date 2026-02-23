---
date: '2026-02-23T21:00:00Z'
author: claude-sonnet-4-6
session: unknown
type: handoff
importance: 0.6
tags: [handoff, readme, docs, scalar, mcp-server]
supersedes: null
signature: pending
---

# Handoff: README Redesign — Remove Stale Tool Tables, Add Scalar UI

## What Was Done This Session

- **Diagnosed doc drift**: README MCP tool tables were already stale (wrong tool names, missing tools). `docs/MCP_SERVER.md` had the same problem — 600+ lines of manually-maintained content that diverged from source.
- **Designed a zero-maintenance approach**: delete all per-tool docs from README and MCP_SERVER.md; replace with pointers to self-describing sources (MCP `tools/list`, CLI `--help`, hosted Scalar UI).
- **Added Scalar API reference UI** (`@scalar/fastify-api-reference`) to `apps/rest-api`. Served at `/docs`, auto-detects the OpenAPI spec from `@fastify/swagger`. Hit a type bug in the package (`configuration.spec` is valid at runtime but omitted from `HtmlRenderingConfiguration` types) — resolved by omitting `configuration` entirely since `@fastify/swagger` auto-detection works.
- **Replaced `docs/MCP_SERVER.md`** with a 4-line pointer to `tools/list` and `ARCHITECTURE.md`.
- **Updated CLAUDE.md MCP tools table** with actual tool names from source (fixed `agent_whoami` → `moltnet_whoami`, added `moltnet_info`, `public_feed_browse/read/search`, all diary/sharing/crypto/vouch tools). Also added `tools/list` pointer so agents don't rely on this table staying current.
- **Rewrote README** — orientation-only, no tool names. Added get-started workflow in both CLI and TS SDK: register → diary → signing flow (3 steps: create request, sign locally, submit) → signed diary entry → search → MCP connect.
- All 219 tests pass, typecheck clean, lint clean.

## What's Not Done Yet

- The Go CLI has no `CreateSigningRequest` command — the full signing flow requires the SDK or REST API for step 1 (`create`). The CLI only handles steps 2+3 via `moltnet sign --request-id <id>`. A follow-up could add `moltnet signing-request create --message <msg>` for full CLI parity.
- Scalar UI not verified visually against a running server (no Docker stack spun up this session). The plugin registration is correct per types and the auto-detection from swagger is documented behaviour.

## Current State

- Branch: `docs/readme-redesign`
- Tests: 219 passing, 0 failing
- Typecheck: clean
- Lint: clean (34 pre-existing warnings in `tools/`, none from this work)
- Commits: 8 commits on top of main

## Decisions Made

- **No generated docs in-repo**: OpenAPI → Scalar UI hosted at `api.themolt.net/docs`. MCP tools → `tools/list`. CLI → `--help`. Zero maintenance.
- **`@scalar/fastify-api-reference` over `@fastify/swagger-ui`**: cleaner UI, OpenAPI 3.1 support, actively maintained.
- **No `configuration.spec`**: Scalar auto-detects from `@fastify/swagger` when `configuration.spec` is omitted. The `spec` field exists at runtime but is typed out of `HtmlRenderingConfiguration` — a bug in the package, not our code.
- **SDK `signBytes(req.signing_input)` in get-started example**: cleaner than `sign(message, nonce, path)` because it doesn't require knowing the framing protocol.

## Open Questions

- Should the Scalar UI be disabled in production (only dev/staging) or public-facing? Currently always registered.
- Should CLI get `moltnet signing-request create`? Would complete the full signing flow without SDK dependency.

## Where to Start Next

1. Merge this PR after review
2. Verify Scalar UI at `https://api.themolt.net/docs` after deployment
3. Optional follow-up: add `moltnet signing-request create` CLI command
