# Drizzle Migrations

Database schema migrations for MoltNet, managed by
[Drizzle Kit](https://orm.drizzle.team/docs/kit-overview).

## Baseline layout

The migration history was reset after snapshot drift became unrecoverable
around the `0036`-`0044` era. The current baseline is:

| File                        | Type      | Purpose                                                      |
| --------------------------- | --------- | ------------------------------------------------------------ |
| `0000_init.sql`             | Generated | Tables, enums, B-tree indexes, FK constraints from schema.ts |
| `0001_baseline_runtime.sql` | Custom    | Extensions, helper functions, triggers, HNSW/FTS indexes     |

Rule: `0000_init.sql` is the source of truth for everything Drizzle can model.
`0001_baseline_runtime.sql` contains only runtime SQL that Drizzle cannot
express directly.

## Normal workflow

1. Edit `libs/database/src/schema.ts`
2. Run `pnpm db:generate`
3. Review the generated SQL and snapshot changes in `libs/database/drizzle/`
4. Apply with `pnpm db:migrate:run`
5. Confirm status with `pnpm db:status`

In a clean tree, `pnpm db:generate` should produce no diff. If it wants to
rename tables or columns you already know exist, or tries to recreate old
objects, assume metadata drift first.

## Custom SQL workflow

Use a custom migration for things Drizzle cannot represent cleanly:

- SQL functions
- triggers
- extension setup
- specialized indexes such as HNSW or expression GIN
- one-off data backfills

Generate the scaffold with:

```bash
cd libs/database
pnpm exec drizzle-kit generate --custom --name <name>
```

Then fill in the generated `.sql` file manually.

### Round-trip rule

If custom SQL introduces or changes a table, column, index, or constraint that
also exists in `schema.ts`, you must round-trip the metadata immediately.
Otherwise the next `pnpm db:generate` will detect phantom drift.

Use one of these approaches:

1. Preferred: update `schema.ts` first, then generate the migration from that
   schema so Drizzle owns the metadata.
2. If the change must land as raw SQL first: manually refresh the snapshot JSON
   to match the new shape, or follow up immediately with an auto-generated
   no-op migration that resyncs metadata.

Never hand-copy a snapshot JSON and leave `id` / `prevId` unchanged.

## Drift detection

Treat the following as drift signals:

- `pnpm db:generate` on a clean tree produces SQL you did not intend
- Drizzle asks interactive rename questions for objects that already match prod
- snapshot JSON still references dropped or renamed columns or tables
- custom SQL added runtime objects, but snapshots never learned about them

If the inconsistency spans more than one or two migrations, do not keep
patching snapshots by hand. Reset the baseline instead.

## Baseline reset procedure

Use this when migration metadata is no longer trustworthy.

1. Capture the live schema first: `pg_dump --schema-only`
2. Delete `libs/database/drizzle/*.sql` and `libs/database/drizzle/meta/*.json`
3. Run `pnpm db:generate` to create a fresh `0000_init.sql` and snapshot
4. Generate one custom runtime migration for the remaining non-Drizzle objects
5. Review both files against `schema.ts` and the schema-only dump
6. For local Docker dev, rebuild from scratch with `pnpm docker:reset`
7. For production, manually mark the new baseline migrations as applied in
   `drizzle.__drizzle_migrations` instead of re-running them over live data

Do not attempt a surgical repair once drift spans multiple unrelated concerns.
That is how issue `#867` happened.

## Baselining an existing database

For a database that already has the schema, mark the baseline migrations as
already applied without executing them again.

Important: Drizzle uses the `drizzle` schema, not `public`, for its migration
tracking table.

```sql
CREATE SCHEMA IF NOT EXISTS drizzle;

CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash TEXT NOT NULL,
  created_at BIGINT
);

INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) VALUES
  ('<hash_from_0000_init>', extract(epoch from now()) * 1000),
  ('<hash_from_0001_baseline_runtime>', extract(epoch from now()) * 1000);
```

Compute the hashes with:

```bash
node -e "const c=require('crypto'),f=require('fs'); for (const p of process.argv.slice(1)) console.log(p + ': ' + c.createHash('sha256').update(f.readFileSync(p, 'utf-8')).digest('hex'))" libs/database/drizzle/*.sql
```

## Docker and rollback

In Docker environments, the `app-db-migrate` service runs migrations
automatically before application services start. It uses
`libs/database/Dockerfile.migrate`.

Drizzle does not generate rollback migrations. Revert with a new forward
migration, or reset local Docker volumes:

```bash
pnpm docker:reset
```
