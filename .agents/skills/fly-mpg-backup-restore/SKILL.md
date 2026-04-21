---
name: fly-mpg-backup-restore
description: 'Use when working with Fly Managed Postgres backups, Fly MPG proxy access, pg_dump or pg_restore from a proxied production database, or when testing app/backfill behavior on a restored local copy of prod.'
---

# Fly MPG Backup Restore

Workflow for backing up the MoltNet Fly Managed Postgres database through a Fly
proxy and restoring it into an isolated local database for schema inspection or
backfill rehearsal.

## When to trigger

- Taking a local backup of the Fly database
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
  -c 'create extension if not exists "uuid-ossp";' \
  -c 'create extension if not exists pgcrypto;'
```

Restore without `--clean`:

```bash
docker run --rm --network host -e PGPASSWORD=moltnet_secret -v /tmp:/dump postgres:17 \
  pg_restore --no-owner --no-privileges \
  -h 127.0.0.1 -p 55433 -U moltnet -d moltnet_prod_restore \
  /dump/themoltnet-prod-app.dump
```

One `schema "public" already exists` warning is expected.

6. Verify the restored copy:

```bash
docker exec themoltnet-pg17-restore-test \
  psql -U moltnet -d moltnet_prod_restore \
  -c "select extname from pg_extension where extname in ('vector', 'uuid-ossp', 'pgcrypto') order by 1;" \
  -c "select count(*) as migration_rows from drizzle.__drizzle_migrations;" \
  -c "select to_regclass('public.agents') as agents, to_regclass('public.humans') as humans, to_regclass('public.diary_entries') as diary_entries;" \
  -c "select count(*) as diaries from public.diaries;" \
  -c "select count(*) as diary_entries from public.diary_entries;"
```

7. Optionally test the app against the restored database with the dedicated
   compose override:

```bash
COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml up -d kratos hydra keto
COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml -f docker-compose.restore-test.yaml up -d rest-api-restore
curl -sf http://127.0.0.1:8081/health
curl -sf 'http://127.0.0.1:8081/public/feed?limit=1'
```

This override assumes the restored database came from this skill's restore flow
and is reachable at `host.docker.internal:55433`.

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
