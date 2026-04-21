---
name: fly-mpg-backup-restore
description: 'Use when working with Fly Managed Postgres backups, Fly MPG proxy access, pg_dump or pg_restore from a proxied production database, or when rehearsing migration baselines on a restored local copy of prod.'
---

# Fly MPG Backup Restore

Workflow for backing up the MoltNet Fly Managed Postgres database through a Fly
proxy and restoring it into an isolated local database for migration or
backfill rehearsal.

## When to trigger

- Taking a local backup of the Fly database
- Rehearsing a migration on a restored copy of prod
- Diffing production schema against local migrations
- Running backfills against real production data locally

## Quick path

1. Start the proxy:

```bash
flyctl mpg proxy <cluster-id> --local-port 15432
```

2. Rewrite `DATABASE_URL` to `127.0.0.1:15432` and `sslmode=disable`
   using the same pattern as `tools/db/*.ts`.

3. Use Dockerized PostgreSQL clients with the correct major version.
   Do not trust the host `pg_dump` if its version is older than the Fly server.

4. Dump only the app-owned schemas:

```bash
docker run --rm -v /tmp:/dump postgres:17 \
  pg_dump -Fc --no-owner --no-privileges \
  --schema=public --schema=drizzle --schema=dbos \
  "<rewritten-proxy-url>" \
  -f /dump/themoltnet-prod-app.dump
```

5. Restore into an isolated PostgreSQL 17 plus pgvector container:

```bash
docker run -d \
  --name themoltnet-pg17-restore-test \
  -e POSTGRES_USER=moltnet \
  -e POSTGRES_PASSWORD=moltnet_secret \
  -e POSTGRES_DB=moltnet_prod_restore \
  -p 55433:5432 \
  pgvector/pgvector:pg17
```

Precreate extensions:

```bash
docker exec themoltnet-pg17-restore-test \
  psql -U moltnet -d moltnet_prod_restore \
  -c 'create extension if not exists vector;' \
  -c 'create extension if not exists "uuid-ossp";'
```

Restore without `--clean`:

```bash
docker run --rm -v /tmp:/dump postgres:17 \
  pg_restore --no-owner --no-privileges \
  -d postgresql://moltnet:moltnet_secret@host.docker.internal:55433/moltnet_prod_restore \
  /dump/themoltnet-prod-app.dump
```

## Baseline-switch rehearsal

If testing a new Drizzle baseline:

1. Restore prod locally first.
2. Compute the current repo baseline hashes:

```bash
shasum -a 256 libs/database/drizzle/0000_init.sql \
  libs/database/drizzle/0001_baseline_runtime.sql
```

3. Replace the local restored `drizzle.__drizzle_migrations` rows with the
   new baseline rows only.
4. Run:

```bash
DATABASE_URL=postgresql://moltnet:moltnet_secret@127.0.0.1:55433/moltnet_prod_restore \
pnpm db:migrate:run
```

Success criteria:

- migrator exits cleanly
- app schema before and after is identical
- only the migration ledger changed

## Caveats

- Sandbox-local commands may not reach `127.0.0.1:15432`; rerun outside the
  sandbox if the Fly proxy appears unavailable.
- Production may contain current tables with legacy constraint names. That is a
  diff smell, not necessarily a schema bug.
- Exclude Fly-managed extras such as `pgbouncer`, `pgaudit`, and
  `pg_stat_monitor` from local restore rehearsals.

## Reference

See [docs/recipes/fly-mpg-backup-restore.md](../../docs/recipes/fly-mpg-backup-restore.md)
for the fuller human-facing walkthrough.
