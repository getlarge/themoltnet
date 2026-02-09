---
date: '2026-02-08T22:00:00Z'
author: claude-opus-4-6
session: unknown
type: handoff
importance: 0.7
tags: [handoff, database, migrations, drizzle, docker, ws3]
supersedes: null
signature: pending
---

# Handoff: Drizzle Migration Tooling

## What Was Done This Session

- Generated three ordered Drizzle migrations from `schema.ts` + `init.sql`:
  - `0000_extensions.sql` — custom: pgvector, uuid-ossp, DBOS schema
  - `0001_initial_schema.sql` — auto-generated: 5 tables, 2 enums, all B-tree indexes, FK constraints
  - `0002_custom_functions_indexes.sql` — custom: hybrid_search(), updated_at triggers, HNSW + FTS indexes, table comments
- Created programmatic migration runner (`migrate.ts`), CLI entry point (`migrate-cli.ts`), and status checker (`migrate-status.ts`)
- Exported `runMigrations` from `@moltnet/database` package index
- Added `db:migrate:run` and `db:status` scripts to both workspace and root `package.json`
- Created `Dockerfile.migrate` (multi-stage, pnpm deploy --prod)
- Added `app-db-migrate` service to all four docker-compose files (base, dev, e2e, main)
- Removed `init.sql` volume mounts from all compose files
- E2E `server` service now depends on `app-db-migrate: condition: service_completed_successfully`
- Marked `init.sql` as documentation-only with header comment
- Created `drizzle/README.md` with migration workflow, rollback strategy, and baselining guide

## What's Not Done Yet

- **Local integration test**: Haven't run `docker compose up` to verify `app-db-migrate` completes successfully (requires Docker running)
- **E2E test**: Haven't run `docker compose -f docker-compose.e2e.yaml up` end-to-end
- **Production baselining**: The Supabase production database needs a one-time procedure to insert records into `__drizzle_migrations` (documented in `drizzle/README.md`)
- **PR creation**: Commits are on `claude/64-drizzle-migration-tooling`, pushed, PR pending

## Current State

- Branch: `claude/64-drizzle-migration-tooling` (4 commits ahead of main)
- Tests: 29 passing, 0 failing (database package)
- Typecheck: clean (database package; pre-existing failure in mcp-auth-proxy is unrelated)
- Lint: 0 errors (2 pre-existing warnings in dbos.ts and voucher.repository.ts)
- Build: clean

## Decisions Made

- **Migration ordering**: Extensions first (0000), then schema (0001), then custom SQL (0002). Extensions must precede schema because tables reference `vector(384)`.
- **DBOS schema in extensions migration**: `CREATE SCHEMA IF NOT EXISTS dbos` goes in `0000_extensions.sql` since it's a prerequisite for the DBOS system tables.
- **CLI scripts use eslint-disable**: `migrate-cli.ts` and `migrate-status.ts` legitimately access `process.env` directly (they're standalone CLI entry points, not library code). Used file-level `eslint-disable` for `no-console` and `no-restricted-syntax`.
- **Dockerfile pattern**: Followed the same multi-stage pattern as `apps/mcp-server/Dockerfile` — base → deps → build → production. Uses `pnpm deploy --legacy --prod` to extract only production deps.
- **No init.sql volume**: All compose files now rely on `app-db-migrate` instead of `docker-entrypoint-initdb.d/init.sql`. This is a breaking change for existing dev volumes — documented in PR description.

## Open Questions

- Should `app-db-migrate` in `docker-compose.yaml` (profiles version) require a profile? Currently set to `[dev, ci]` to match other services.

## Mission Integrity Check

Per `docs/MISSION_INTEGRITY.md`:

- **T1 (Cryptographic Anchoring)**: No impact. Migrations don't touch signing or key management. The `signing_requests` table is faithfully reproduced from the Drizzle schema.
- **T2 (Design for Exit)**: **Positive impact.** Drizzle migrations are standard SQL files — fully portable to any Postgres instance. This _reduces_ vendor lock-in vs the previous Supabase-specific `init.sql` approach. The migration runner uses `pg` Pool directly, no Supabase SDK.
- **T4 (Offline-First Verification)**: No impact. Migration tooling is infrastructure-only.
- **Threat 6 (Social Engineering)**: The auto-generated migration (`0001_initial_schema.sql`) was produced by `drizzle-kit generate` from the existing `schema.ts` — it's deterministic and auditable. Custom SQL in `0000` and `0002` is extracted verbatim from the existing `init.sql`. No new schema logic introduced.
- **Threat 9 (Supply Chain)**: No new dependencies added. `drizzle-orm/node-postgres/migrator` and `pg` are already in the dependency tree. `drizzle-kit` remains a devDependency only.
- **No admin backdoors, no telemetry, no key handling, no scope widening.**

## Where to Start Next

1. Create PR targeting main
2. Test locally with `pnpm docker:reset && docker compose -f docker-compose.dev.yaml up -d`
3. Verify `app-db-migrate` exits successfully and `pnpm db:status` shows all applied
4. Run E2E tests: `docker compose -f docker-compose.e2e.yaml up -d`
