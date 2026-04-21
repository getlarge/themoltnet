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
The `tools/db/*.ts` scripts rewrite that URL to `localhost:15432` and set
`sslmode=disable` when using a Fly proxy.

## 1. Start the Fly MPG proxy

```bash
flyctl mpg proxy <cluster-id> --local-port 15432
```

Keep this terminal open for the entire backup operation.

## 2. Rewrite the production connection string to the proxy

The repo pattern is:

```bash
npx dotenvx run --env-file .env --env-file env.public -- node -e "
const raw = process.env.DATABASE_URL;
if (!raw || raw.startsWith('encrypted:')) throw new Error('DATABASE_URL unavailable');
const url = new URL(raw);
url.hostname = '127.0.0.1';
url.port = '15432';
url.searchParams.set('sslmode', 'disable');
console.log(url.toString());
"
```

## 3. Take the dump with a PostgreSQL 17 client

Do not rely on the host `pg_dump` unless its major version matches the Fly
server. The production cluster currently reports PostgreSQL 17, so use a
PostgreSQL 17 client in Docker.

### Full app dump

This captures only the app-owned schemas and avoids Fly-managed extras such as
`pgbouncer`, `pg_stat_monitor`, and `pgaudit`.

```bash
docker run --rm -v /tmp:/dump postgres:17 \
  pg_dump -Fc --no-owner --no-privileges \
  --schema=public --schema=drizzle --schema=dbos \
  "<rewritten-proxy-url>" \
  -f /dump/themoltnet-prod-app.dump
```

### Schema-only dump

Useful for diffing before touching anything:

```bash
docker run --rm -v /tmp:/dump postgres:17 \
  pg_dump --schema-only --no-owner --no-privileges \
  "<rewritten-proxy-url>" \
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
  -c 'create extension if not exists "uuid-ossp";'
```

Restore the dump:

```bash
docker run --rm -v /tmp:/dump postgres:17 \
  pg_restore --no-owner --no-privileges \
  -d postgresql://moltnet:moltnet_secret@host.docker.internal:55433/moltnet_prod_restore \
  /dump/themoltnet-prod-app.dump
```

Important:

- Do **not** use `--clean` here after precreating extensions. On this path it
  creates unnecessary churn around `public` and extension-owned objects.
- The restore target should start empty except for the extensions you
  intentionally created.

## 5. Verify the restore

Examples:

```bash
docker exec themoltnet-pg17-restore-test \
  psql -U moltnet -d moltnet_prod_restore \
  -c "select count(*) from drizzle.__drizzle_migrations;"
```

```bash
docker exec themoltnet-pg17-restore-test \
  psql -U moltnet -d moltnet_prod_restore \
  -c "select exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'agents') as has_agents, exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'humans') as has_humans;"
```

## 6. Rehearse a baseline ledger switch locally

If the goal is to replace the old 45-step Drizzle history with the new
two-migration baseline, do it on the restored local copy first.

Compute the current baseline hashes from the repo:

```bash
shasum -a 256 libs/database/drizzle/0000_init.sql \
  libs/database/drizzle/0001_baseline_runtime.sql
```

Then, in the restored local database only, replace the migration ledger rows:

```sql
BEGIN;

ALTER TABLE drizzle.__drizzle_migrations
  RENAME TO __drizzle_migrations_prebaseline;

CREATE TABLE drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash TEXT NOT NULL,
  created_at BIGINT
);

INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES
  ('<hash_from_0000_init>', extract(epoch from now()) * 1000),
  ('<hash_from_0001_baseline_runtime>', extract(epoch from now()) * 1000);

COMMIT;
```

Now point the repo migrator at the restored database and verify it is a no-op:

```bash
DATABASE_URL=postgresql://moltnet:moltnet_secret@127.0.0.1:55433/moltnet_prod_restore \
pnpm db:migrate:run
```

If that succeeds and a schema-only dump before/after is identical, the baseline
bookkeeping switch is rehearsed successfully.

## Known caveats

- Fly proxy access is local only. If commands inside the sandbox cannot reach
  `127.0.0.1:15432`, rerun them outside the sandbox.
- Host `pg_dump` / `pg_restore` major-version mismatch against the server is a
  real failure mode. Use Dockerized clients with matching versions.
- Production may contain renamed objects whose **data model** is current but
  whose **constraint names** still reflect legacy names. Treat that as expected
  when diffing restored prod against a fresh local baseline.
