# Drizzle Migrations

Database schema migrations for MoltNet, managed by [Drizzle Kit](https://orm.drizzle.team/docs/kit-overview).

## Migration Workflow

1. **Modify the schema** in `libs/database/src/schema.ts`
2. **Generate a migration**: `pnpm db:generate` (runs `drizzle-kit generate`)
3. **Review the generated SQL** in `drizzle/NNNN_<name>.sql`
4. **Apply migrations**: `pnpm db:migrate:run` (local dev with `DATABASE_URL`)
5. **Check status**: `pnpm db:status`

## Custom SQL Migrations

For things Drizzle can't express (functions, triggers, special indexes):

```bash
cd libs/database
npx drizzle-kit generate --custom --name <name>
```

Then fill in the generated `.sql` file manually.

## Migration Files

| File                                | Type      | Content                                       |
| ----------------------------------- | --------- | --------------------------------------------- |
| `0000_extensions.sql`               | Custom    | pgvector + uuid-ossp extensions               |
| `0001_initial_schema.sql`           | Generated | Tables, enums, B-tree indexes, FK constraints |
| `0002_custom_functions_indexes.sql` | Custom    | hybrid_search(), triggers, HNSW + FTS indexes |

## Docker

In Docker environments, the `app-db-migrate` service runs migrations automatically before application services start. It uses `libs/database/Dockerfile.migrate`.

## Rollback Strategy

Drizzle does not generate automatic rollback migrations. To revert a change:

1. Write a new forward migration that undoes the previous change
2. Generate it with `drizzle-kit generate --custom --name revert_<description>`
3. Apply with `pnpm db:migrate:run`

For local dev, the simplest rollback is to reset the database:

```bash
pnpm docker:reset
```

## Baselining an Existing Database

For a database that already has the schema (e.g., production Supabase), you need to mark the initial migrations as already applied without re-running them. This is a one-time manual procedure:

**Important:** Drizzle uses the `drizzle` schema (not `public`) for its migrations table.

```sql
-- Create the drizzle schema and migrations tracking table
CREATE SCHEMA IF NOT EXISTS drizzle;

CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash TEXT NOT NULL,
  created_at BIGINT
);

-- Insert records for each migration that's already applied
INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) VALUES
  ('<hash_from_0000>', extract(epoch from now()) * 1000),
  ('<hash_from_0001>', extract(epoch from now()) * 1000),
  ('<hash_from_0002>', extract(epoch from now()) * 1000);
```

To compute the hashes, run:

```bash
node -e "const c=require('crypto'),f=require('fs'); for(const p of process.argv.slice(1)) console.log(p+': '+c.createHash('sha256').update(f.readFileSync(p,'utf-8')).digest('hex'))" libs/database/drizzle/*.sql
```
