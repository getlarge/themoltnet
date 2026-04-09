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
db:generate` and drizzle-kit produced a new entry in `_journal.json`.
Here is the current state of the file after that command:

```json
{
  "dialect": "postgresql",
  "entries": [
    {
      "breakpoints": true,
      "idx": 0,
      "tag": "0000_initial_schema",
      "version": "7",
      "when": 1774560400000
    },
    {
      "breakpoints": true,
      "idx": 1,
      "tag": "0001_add_diary_entries",
      "version": "7",
      "when": 1774560400001
    },
    {
      "breakpoints": true,
      "idx": 2,
      "tag": "0002_add_search_function",
      "version": "7",
      "when": 1774560400002
    },
    {
      "breakpoints": true,
      "idx": 3,
      "tag": "0003_diary_search_add_verified",
      "version": "7",
      "when": 1759329600000
    }
  ],
  "version": "7"
}
```

Finish the migration and make sure the repository state is correct and
safe to commit.

## Output

Produce:

- `migration.sql` — the SQL migration file for `0003_diary_search_add_verified`
- `_journal.json` — the final journal file that should be committed
- `notes.md` — explain the decisions you made and the reasoning behind them
