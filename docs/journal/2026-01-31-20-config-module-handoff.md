---
date: '2026-01-31T19:15:00Z'
author: claude-opus-4-5-20251101
session: unknown
type: handoff
importance: 0.7
tags: [handoff, config, typebox, validation, eslint, security]
supersedes: null
signature: pending
---

# Handoff: Config Module with TypeBox Validation + ESLint Guard

## What Was Done This Session

- Created `apps/rest-api/src/config.ts` with 5 separate TypeBox schemas (Server, Database, Webhook, Ory, Observability) so secrets don't leak across the app
- Each schema has its own loader (`loadServerConfig`, `loadWebhookConfig`, etc.) plus a combined `loadConfig()` that returns all slices
- Added `resolveOryUrls()` — supports both Ory Network (single project URL) and self-hosted (per-service URLs) with fallback resolution
- Helpers use `Value.Convert` → `Value.Default` → `Value.Check`/`Value.Errors` for coercion, defaults, and clear error messages
- All loaders accept injectable `env` parameter (defaults to `process.env`) for testing
- Created 24 config tests covering validation, coercion, defaults, cross-leak prevention, and Ory URL resolution
- Added ESLint `no-restricted-syntax` rule forbidding `process.env` in source files, exempting `**/config.ts`
- Refactored `libs/database/src/db.ts` — `getDatabase()` now accepts a URL parameter instead of reading `process.env`
- Exported all config types and loaders from `apps/rest-api/src/index.ts`
- Also includes pre-existing webhook security improvements (API key auth on hook routes, timing-safe comparison)

## What's Not Done Yet

- Config module is not yet wired into the app entry point (no `main.ts` / server bootstrap exists yet)
- Ory client factory (`createOryClients`) still accepts a single `baseUrl` — follow-up to accept per-service URLs from `resolveOryUrls()`
- `DATABASE_URL`, Axiom vars, and Ory URLs are optional in config — make them required when services come online

## Current State

- Branch: `claude/config-module-typebox-validation`
- Tests: 354 passing across all workspaces (59 in rest-api, including 24 new config tests)
- Typecheck: clean
- Lint: 0 errors (12 pre-existing warnings)

## Decisions Made

- **Separate schemas per concern** — webhook routes never see DATABASE_URL, diary service never sees ORY_ACTION_API_KEY
- **`pickEnv` helper** — only extracts keys defined in the schema, preventing accidental leakage of extra env vars
- **Ory two-mode support** — individual per-service URLs take precedence over ORY_PROJECT_URL fallback; throws if neither is available
- **ESLint enforcement** — `process.env` access is banned in all source files except config.ts; tests are unaffected (relaxed rules)
- **Database refactor** — getDatabase() requires URL on first call instead of reading process.env; singleton reused after

## Where to Start Next

1. Wire `loadConfig()` into the server bootstrap when `apps/rest-api/src/main.ts` is created
2. Pass `config.webhook.ORY_ACTION_API_KEY` to `buildApp({ webhookApiKey })` and `config.database.DATABASE_URL` to `getDatabase()`
3. Refactor `createOryClients` to accept `ResolvedOryUrls` instead of a single `baseUrl`
4. Make optional fields required as services come online (remove `Type.Optional()`)
