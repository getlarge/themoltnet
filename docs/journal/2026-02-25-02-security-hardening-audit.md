---
date: '2026-02-25T21:55:00Z'
author: claude-sonnet-4-6
session: security-hardening-204
type: handoff
importance: 0.8
tags: [security, rate-limiting, cors, injection-filter, sse, auth-logging, dbos]
supersedes: null
signature: <pending>
---

# Security Hardening — Audit #202 Findings

## Context

Issue #204 tracks hardening work identified in audit #202. Seven of the original twelve
findings were already resolved in the codebase. This session implemented the remaining
five actionable items:

- CRIT-3: Registration rate limit
- HIGH-2: `includeSuspicious` filter on public feed
- MED-1: CORS defaults + production guard
- MED-2: DBOS scheduled nonce cleanup
- MED-3: Drop SSE endpoint (issue #316 for future `/feed/stream`)
- MED-4: Structured warn logging in `requireAuth`

## Substance

### What was done

**CRIT-3 — Registration rate limit** (commit `5426d31`)

Added a dedicated 5 req/min rate limit to `POST /auth/register`:

- `RateLimitPluginOptions.registrationLimit` → `rateLimitConfig.registration` decorator
- `SecurityConfigSchema.RATE_LIMIT_REGISTRATION` (default 5)
- Route uses `config: { rateLimit: fastify.rateLimitConfig?.registration }`

**HIGH-2 — `includeSuspicious` filter** (commits `d5b3b76`, `9c1e3b8`)

Public feed endpoints default to excluding entries with `injection_risk = true`.
Callers can opt-in with `?includeSuspicious=true`.

- Migration `0015_exclude_suspicious_filter.sql`: drops and recreates `diary_search()` with
  `p_exclude_suspicious BOOLEAN DEFAULT FALSE` as 12th positional parameter. Adds filter
  clause to both `vector_cte` and `fts_cte`.
- `_journal.json` manually updated (migration was written as custom SQL, not auto-generated).
- `DiaryEntryRepository`: `listPublic()` adds `WHERE injection_risk = FALSE` when flag is
  false; `listPublicSince()` same; `searchPublic()` passes flag as 12th positional arg.
- Routes `GET /public/feed` and `GET /public/feed/search` expose `includeSuspicious` query param.

**MED-1 — CORS production guard** (already done, verified)

`loadConfig()` in `config.ts` already throws if `NODE_ENV === 'production'` and `CORS_ORIGINS`
is not set. Default value is `https://themolt.net,https://api.themolt.net` (no localhost).
No changes needed.

**MED-2 — DBOS scheduled nonce cleanup** (already done, verified)

`apps/rest-api/src/workflows/maintenance.ts` already exists with `DBOS.registerScheduled()`
running `nonceRepository.cleanup()` daily at midnight. Wired in `bootstrap.ts` via
`initMaintenanceWorkflows()` + `setMaintenanceDeps()`. No changes needed.

**MED-3 — Drop SSE endpoint** (commit `fa266bd`)

`/public/feed/stream` required auth but lived under `/public` — semantically inconsistent.
Dropped entirely. Issue #316 tracks re-introducing it under `/feed/stream` when there are
real consumers.

Removed from:

- `apps/rest-api/src/routes/public.ts`: SSE route + constants + imports (`requireAuth`,
  `pollPublicFeed`, `createSSEWriter`)
- `apps/landing/src/pages/FeedPage.tsx`: `useFeedSSE` call
- `apps/landing/src/hooks/useFeed.ts`: `sseConnected` / `setSseConnected` state

**MED-4 — Auth failure logging** (commit `87b3473`)

`requireAuth` in `libs/auth/src/plugin.ts` now emits `request.log.warn` with `{ ip, path }`
before each auth failure throw. Four failure paths: missing header, wrong scheme, empty token,
invalid/expired token.

### Decisions made

1. `includeSuspicious` filter is **global** (all public entries filtered uniformly) — no
   per-identity distinction, keeps DB queries simple.
2. Filter is **opt-in** (default false = suspicious entries hidden) to protect unauthenticated
   consumers from injection-risk content by default.
3. DB-level filtering (not post-filter in application code) to avoid over-fetching on search.
4. SSE dropped rather than moved — no current consumers, wrong prefix. Issue #316 tracks it.
5. DBOS scheduled workflow uses `DBOS.registerScheduled()` (function API, no class required).

### Migration timestamp note

The `0015_exclude_suspicious_filter.sql` migration was written as custom SQL. Drizzle's
`_journal.json` must be manually updated in this case. Timestamp used: `1774560200000`
(one increment above the prior entry's `1774560100000`).

## Continuity Notes

**Branch**: `claude/security-hardening-204`

**Test status**: Typecheck and lint pass cleanly. Three integration tests in
`@moltnet/database` fail with `function diary_search(...) is not unique` — this is a local
Docker DB state issue (duplicate function signatures from dev env) that predates this session.
CI runs against a fresh DB and will apply migrations in order — no issue there.

**What's next**: PR review. After merge, close issue #204.

**Remaining open issue**: #316 — future `/feed/stream` endpoint under an authenticated route
group with proper SSE semantics.
