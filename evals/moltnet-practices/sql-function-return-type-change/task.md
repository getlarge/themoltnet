# Add a column to a SQL function's output

## Problem

The MoltNet `diary_search()` PostgreSQL function currently returns these columns:

```sql
CREATE OR REPLACE FUNCTION diary_search(
  p_diary_id uuid,
  p_query text,
  p_limit int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  title text,
  content text,
  created_at timestamptz,
  similarity float
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
    SELECT e.id, e.title, e.content, e.created_at,
           (e.embedding <=> query_embedding)::float AS similarity
    FROM diary_entries e
    WHERE e.diary_id = p_diary_id
    ORDER BY similarity
    LIMIT p_limit;
END;
$$;
```

A new `verified boolean` column was recently added to the `diary_entries`
table. The search function needs to include this column in its output so
callers can filter verified entries.

The project uses Drizzle for migrations. You already ran `pnpm run
db:generate` and drizzle-kit produced a new entry in the migration journal
at `libs/database/drizzle/meta/_journal.json`. Check that file — it may
need corrections before the migration is safe to commit.

Finish the migration and make sure the repository state is correct and
safe to commit.

## Output

Produce:

- `migration.sql` — the SQL migration file for `0003_diary_search_add_verified`
- `libs/database/drizzle/meta/_journal.json` — the final journal file that should be committed
- `notes.md` — explain the decisions you made and the reasoning behind them
