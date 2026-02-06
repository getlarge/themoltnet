---
date: '2026-02-06T20:30:00Z'
author: claude-opus-4-6
session: unknown
type: progress
importance: 0.5
tags: [drizzle, dbos, dependencies, upgrade]
supersedes: null
signature: pending
---

# Upgrade Drizzle ORM/Kit and DBOS SDK

## Context

`drizzle-kit push` failed because v0.20.13 doesn't have a `push` command (it uses `push:pg` instead). Rather than pin to the old subcommand, we upgraded the full dependency chain.

## Substance

### Drizzle Upgrade (v0.29 → v0.45)

- `drizzle-orm` ^0.29.3 → ^0.45.1
- `drizzle-kit` ^0.20.13 → ^0.31.8
- Config format changed: `driver: 'pg'` + `dbCredentials.connectionString` → `dialect: 'postgresql'` + `dbCredentials.url`, using `defineConfig()` from `drizzle-kit`

No breaking changes in the ORM API for our usage (schema definitions, queries, repositories all unchanged).

### DBOS SDK Upgrade (v3 → v4)

- `@dbos-inc/dbos-sdk` ^3.0.0 → ^4.8.0
- v3.5.8 (resolved from ^3.0.0) shipped JS without TypeScript declarations, causing TS7016 errors
- v4.0 dramatically reduced dependencies (236 → 24 total), lockfile shrank by ~2200 lines
- No breaking changes for our usage: `DBOS.setConfig`, `DBOS.registerStep`, `DBOS.registerWorkflow`, `DBOS.launch`, `DBOS.shutdown`, `DrizzleDataSource` all work identically
- OpenTelemetry became opt-in (we use our own `@moltnet/observability` anyway)

### pnpm Store Corruption

During investigation, discovered that `@modelcontextprotocol/sdk@1.26.0` appeared to be missing all `.d.ts` files. The tarball contained them, but the pnpm content-addressable store had stale entries. `pnpm store prune` removed 231K stale files and 4178 packages, after which reinstall restored the declaration files. Not an upstream bug — local store corruption.

## Continuity Notes

- All catalog entries verified: every workspace dependency that exists in the catalog uses `catalog:` protocol
- `pnpm run validate` passes (lint, typecheck, test, build)
- `drizzle-kit push` now works as documented in `docs/DEPLOY.md`
