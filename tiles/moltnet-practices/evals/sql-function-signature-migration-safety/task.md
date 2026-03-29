# PostgreSQL Search Function Migration

## Problem/Feature Description

A document management system uses a PostgreSQL function `document_search()` for hybrid full-text and vector similarity search. The product team needs to add two new audit columns to the `documents` table: `content_hash` (text) and `reviewed_at` (timestamptz). These new columns need to be surfaced in search results — meaning the `document_search()` function's return type must be updated.

The database team has asked you to write the migration SQL. The last time someone modified this function, the migration was applied silently on production but the search results were wrong — new columns returned NULL despite being present in the table. The team has learned to be very careful with PostgreSQL function modifications and wants the migration written correctly.

Your migration must:

1. Add the two new columns to the `documents` table
2. Update the `document_search()` function to include the new columns in its results

Write the SQL migration file that accomplishes this safely.

## Output Specification

- `migration.sql` — the complete SQL migration
- `notes.md` — a short explanation of why the migration is structured the way it is

## Input Files (optional)

The following files are provided as inputs. Extract them before beginning.

=============== FILE: inputs/current*function.sql ===============
CREATE OR REPLACE FUNCTION document_search(
query_text text,
query_embedding vector(384),
match_limit integer DEFAULT 10
)
RETURNS TABLE (
id uuid,
title text,
body text,
author_id uuid,
created_at timestamptz,
rank double precision
)
LANGUAGE plpgsql AS $$
BEGIN
RETURN QUERY
SELECT
d.id,
d.title,
d.body,
d.author_id,
d.created_at,
(
0.7 * (1 - (d.embedding <=> query*embedding)) +
0.3 * ts_rank(to_tsvector('english', d.body), plainto_tsquery('english', query_text))
)::double precision AS rank
FROM documents d
WHERE to_tsvector('english', d.body) @@ plainto_tsquery('english', query_text)
OR (d.embedding <=> query_embedding) < 0.5
ORDER BY rank DESC
LIMIT match_limit;
END;

$$
;

=============== FILE: inputs/current_schema.sql ===============
CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  author_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  embedding vector(384)
);
$$
