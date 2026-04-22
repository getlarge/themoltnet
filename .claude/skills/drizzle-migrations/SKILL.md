---
name: drizzle-migrations
description: 'Use when changing libs/database/src/schema.ts, adding Drizzle migrations, debugging drizzle-kit drift, or deciding between auto-generated and custom SQL migrations. Includes the post-#867 baseline-reset rule.'
---

# Drizzle Migrations Skill

Operational guide for MoltNet database migrations.

## When to trigger

- Editing `libs/database/src/schema.ts`
- Running `pnpm db:generate`
- Adding a custom SQL migration
- Debugging Drizzle snapshot drift
- Reviewing a PR that changes `libs/database/drizzle/`

## Default workflow

1. Update `libs/database/src/schema.ts`
2. Run `pnpm db:generate`
3. Review generated SQL and snapshot metadata together
4. Apply with `pnpm db:migrate:run` or rebuild local Docker from scratch

If `pnpm db:generate` in a clean tree produces unexpected SQL, stop and assume
drift until proven otherwise.

## Choose the migration type

Use `pnpm db:generate` when the change is representable in Drizzle:

- tables
- columns
- enums
- regular indexes
- foreign keys
- not-null, default, or basic constraint changes

Use `pnpm exec drizzle-kit generate --custom --name <name>` when the change is
not representable cleanly:

- SQL functions
- triggers
- extension setup
- HNSW or expression GIN indexes
- backfills or data rewrites

## Custom SQL round-trip rule

Custom SQL is allowed, but metadata must stay in sync.

If a custom migration introduces or changes a table, column, index, or
constraint that `schema.ts` also knows about, do one of these immediately:

1. Update `schema.ts` and follow up with an auto-generated migration that
   brings the snapshot chain back in sync.
2. Manually update the latest snapshot JSON to reflect the new shape.

Do not leave a raw SQL structural change unreflected in snapshots. That is how
future `pnpm db:generate` runs start proposing bogus renames and recreations.

## Snapshot invariants

- `meta/*_snapshot.json` `id` and `prevId` must form a valid chain
- never copy-paste a snapshot file without refreshing both IDs
- generated SQL and snapshot metadata must describe the same schema state
- `pnpm db:generate` on a clean tree should be a no-op

## Drift triage

Strong drift signals:

- rename prompts for objects that already exist under the new name
- old names like `owner_id`, `agent_keys`, or `human` reappearing in snapshots
- missing tables in snapshots after a custom SQL migration created them
- repeated no-op churn every time `pnpm db:generate` runs

If the problem spans more than one or two migrations, do not keep patching old
snapshots. Reset the baseline.

## Baseline-reset procedure

Reference: issue `#867`.

1. Capture the live schema with `pg_dump --schema-only`
2. Delete `libs/database/drizzle/*.sql` and `libs/database/drizzle/meta/*.json`
3. Run `pnpm db:generate` to create a fresh `0000_init.sql`
4. Generate one custom runtime migration for non-Drizzle objects
5. Review against the schema dump
6. In production, mark the new baseline migrations as applied in
   `drizzle.__drizzle_migrations` instead of executing them on live data
7. In local Docker dev, rebuild from scratch with `pnpm docker:reset`

Never try to surgically repair deep historical drift. Reset is cheaper and
safer.
