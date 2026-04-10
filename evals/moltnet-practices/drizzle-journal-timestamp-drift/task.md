# Add a new column and generate a Drizzle migration

## Problem

We need to add a `verified_at` column to the `diary_entries` table — a nullable timestamp that records when an entry's content hash was independently verified.

The schema file is at `libs/database/src/schema.ts`. The migration journal is at `libs/database/drizzle/meta/_journal.json`.

1. Add the column to the schema
2. Describe what the generated migration SQL should look like
3. Add the new migration entry to `_journal.json`

Note: you can't run `drizzle-kit generate` in this environment, so write the migration entry manually. Look at the existing journal entries for the naming and numbering convention.

## Output

Produce:

- `schema-fixed.ts` — the updated schema with the new column
- `_journal-fixed.json` — the updated journal with the new migration entry
- `0011_add_verified_at.sql` — the migration SQL
- `notes.md` — explain your approach
