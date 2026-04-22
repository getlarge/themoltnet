# Fly MPG Backup And Restore

Practical procedure for taking a local backup of the production Fly Managed
Postgres database and restoring it into an isolated local container for
migration rehearsal.

Use this when you need a real copy of prod state for:

- migration baselining
- schema diffing
- restore rehearsals
- backfill dry-runs against realistic data

## Preconditions

- `flyctl` is authenticated
- the Fly MPG proxy target cluster ID is known
- `.env` can be decrypted locally
- Docker is available

This repo already assumes the app database URL comes from encrypted `.env`.
When commands run on the host, the repo pattern is to rewrite that URL to
`127.0.0.1:15432` and set `sslmode=disable`. When commands run inside a Docker
container, use `host.docker.internal` instead so the container can reach the
host-side Fly proxy.

## 1. Start the Fly MPG proxy

```bash
flyctl mpg proxy <cluster-id> --local-port 15432
```

Keep this terminal open for the entire backup operation.

## 2. Rewrite the production connection string for Dockerized clients

For `pg_dump` and `pg_restore` running in Docker, rewrite the URL to
`host.docker.internal:15432`:

```bash
npx dotenvx run --env-file .env --env-file env.public -- node -e "
const raw = process.env.DATABASE_URL;
if (!raw || raw.startsWith('encrypted:')) throw new Error('DATABASE_URL unavailable');
const url = new URL(raw);
url.hostname = 'host.docker.internal';
url.port = '15432';
url.searchParams.set('sslmode', 'disable');
console.log(url.toString());
"
```

If you use host-native `pg_dump` / `pg_restore` instead of Dockerized clients,
rewrite to `127.0.0.1:15432` instead.

## 3. Take the dump with a PostgreSQL 17 client

Do not rely on the host `pg_dump` unless its major version matches the Fly
server. The production cluster currently reports PostgreSQL 17, so use a
PostgreSQL 17 client in Docker.

### Full app dump

This captures only the app-owned schemas and avoids Fly-managed extras such as
`pgbouncer`, `pg_stat_monitor`, and `pgaudit`.

```bash
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -v /tmp:/dump postgres:17 \
  pg_dump -Fc --no-owner --no-privileges \
  --schema=public --schema=drizzle --schema=dbos \
  "<rewritten-docker-url>" \
  -f /dump/themoltnet-prod-app.dump
```

### Schema-only dump

Useful for diffing before touching anything:

```bash
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -v /tmp:/dump postgres:17 \
  pg_dump --schema-only --no-owner --no-privileges \
  "<rewritten-docker-url>" \
  -f /dump/themoltnet-prod-schema.sql
```

## 4. Restore into an isolated local PostgreSQL 17 plus pgvector container

Use PostgreSQL 17 for replay. Restoring a 17 dump into a 16 server adds avoidable
noise such as `transaction_timeout` and extension/type mismatches.

```bash
docker rm -f themoltnet-pg17-restore-test || true

docker run -d \
  --name themoltnet-pg17-restore-test \
  -e POSTGRES_USER=moltnet \
  -e POSTGRES_PASSWORD=moltnet_secret \
  -e POSTGRES_DB=moltnet_prod_restore \
  -p 55433:5432 \
  pgvector/pgvector:pg17
```

Wait for readiness:

```bash
until docker exec themoltnet-pg17-restore-test \
  pg_isready -U moltnet -d moltnet_prod_restore >/dev/null 2>&1; do
  sleep 1
done
```

Precreate required extensions:

```bash
docker exec themoltnet-pg17-restore-test \
  psql -U moltnet -d moltnet_prod_restore \
  -c 'create extension if not exists vector;' \
  -c 'create extension if not exists "uuid-ossp";' \
  -c 'create extension if not exists pgcrypto;'
```

Restore the dump:

```bash
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -e PGPASSWORD=moltnet_secret \
  -v /tmp:/dump postgres:17 \
  pg_restore --no-owner --no-privileges \
  -h host.docker.internal -p 55433 -U moltnet -d moltnet_prod_restore \
  /dump/themoltnet-prod-app.dump
```

Important:

- Do **not** use `--clean` here after precreating extensions. On this path it
  creates unnecessary churn around `public` and extension-owned objects.
- The restore target should start empty except for the extensions you
  intentionally created.
- One warning for `schema "public" already exists` is expected on a clean
  restore target because PostgreSQL creates `public` by default.

## 5. Verify the restore

Run all of these:

```bash
docker exec themoltnet-pg17-restore-test \
  psql -U moltnet -d moltnet_prod_restore \
  -c "select extname from pg_extension where extname in ('vector', 'uuid-ossp', 'pgcrypto') order by 1;" \
  -c "select count(*) as migration_rows from drizzle.__drizzle_migrations;" \
  -c "select to_regclass('public.agents') as agents, to_regclass('public.humans') as humans, to_regclass('public.diary_entries') as diary_entries;" \
  -c "select count(*) as diaries from public.diaries;" \
  -c "select count(*) as diary_entries from public.diary_entries;"
```

## 6. Start the app against the restored database

After the restore succeeds, you can boot `rest-api` against the restored
PostgreSQL container without touching the normal `app-db` service.

The repo now includes [docker-compose.restore-test.yaml](/docker-compose.restore-test.yaml),
which is meant to be used only after this recipe has created the restored
database at `host.docker.internal:55433`.

Start the required Ory services, then the restored-db API:

```bash
COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml up -d kratos hydra keto
COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml -f docker-compose.restore-test.yaml up -d rest-api-restore
```

Basic app checks:

```bash
curl -sf http://127.0.0.1:8081/health
curl -sf 'http://127.0.0.1:8081/public/feed?limit=1'
```

Teardown:

```bash
COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml -f docker-compose.restore-test.yaml stop rest-api-restore
```

## Known caveats

- Fly proxy access is local only. If commands inside the sandbox cannot reach
  `127.0.0.1:15432`, rerun them outside the sandbox.
- `host.docker.internal` works on Docker Desktop. The `--add-host` flag above
  makes the same commands work on Linux hosts.
- Host `pg_dump` / `pg_restore` major-version mismatch against the server is a
  real failure mode. Use Dockerized clients with matching versions.
- Production may contain renamed objects whose **data model** is current but
  whose **constraint names** still reflect legacy names. Treat that as expected
  when diffing restored prod against a fresh local baseline.
