---
date: '2026-02-01T10:00:00Z'
author: claude-opus-4-5-20251101
session: unknown
type: handoff
importance: 0.7
tags: [auth, jwt, jwks, opaque-tokens, ws4]
supersedes: null
signature: pending
---

# Handoff: Auth Library — Dual Token Validation (JWKS + Introspection)

## What Was Done This Session

- Claimed WS4: Auth library task
- Added JWKS-based JWT validation to `@moltnet/auth` token validator
- Added `fast-jwt` and `get-jwks` to the pnpm catalog and auth package dependencies
- Implemented dynamic token type detection: Ory opaque tokens (`ory_at_`, `ory_ht_`) route to introspection, JWTs route to local JWKS verification with introspection fallback
- Rewrote token validator tests to cover both validation paths (52 tests, up from 43)
- All 363 workspace tests pass, typecheck clean

## What Was Already Done (Pre-existing)

The auth library (`libs/auth/`) was already substantially built before this session:

- `ory-client.ts` — Ory API client factory (Frontend, Identity, OAuth2, Permission, Relationship)
- `token-validator.ts` — introspection-only token validation (this session added JWKS)
- `permission-checker.ts` — Ory Keto permission checks for diary entries
- `plugin.ts` — Fastify plugin with `requireAuth`, `optionalAuth`, `requireScopes` preHandlers
- `types.ts` — AuthContext, IntrospectionResult types
- Full test coverage across 4 test files

## What Changed

### `libs/auth/src/token-validator.ts`

`createTokenValidator(oauth2Api, config?)` now accepts an optional `TokenValidatorConfig`:

- `jwksUri` — Ory Hydra JWKS endpoint URL
- `allowedIssuers` — JWT issuer allowlist
- `allowedAudiences` — JWT audience allowlist
- `algorithms` — accepted signing algorithms (default: RS256)
- `cacheMax`, `cacheTtl` — JWKS key cache settings

Validation strategy in `resolveAuthContext()`:

1. Token starts with `ory_at_` or `ory_ht_` → introspection (skip JWKS entirely)
2. Token looks like a JWT (3 dot-separated segments) and JWKS is configured → JWKS verification, then introspection fallback if verification fails
3. All other tokens → introspection

### `pnpm-workspace.yaml`

Added to catalog: `fast-jwt: ^5.0.0`, `get-jwks: ^9.0.0`

## Current State

- Branch: `claude/auth-library`
- Tests: 363 passing across all workspaces (52 in auth)
- Build: clean
- TypeCheck: clean

## Decisions Made

- Used `fast-jwt` + `get-jwks` (same as `@getlarge/fastify-mcp` reference) rather than `jose` for consistency
- Detect opaque tokens by prefix rather than trying JWT parse first — avoids unnecessary JWKS calls
- JWKS cache defaults: 50 keys, 10-minute TTL (matches fastify-mcp)
- JWT `scope` claim extracted from either `scope` (string) or `scp` (array) field for compatibility

## What's Not Done Yet

- No integration test with a real Ory project (would need Docker Compose environment)
- The token enrichment webhook (WS2 task) that injects `moltnet:*` claims into JWTs is not yet built — the auth library supports it but can't test end-to-end until the webhook exists

## Where to Start Next

1. The auth library is feature-complete for WS4 scope
2. Next blockers for WS5/WS6: diary-service needs implementation, token enrichment webhook needs building
3. For E2E auth testing: use the Docker Compose environment to spin up local Ory and test real token flows
