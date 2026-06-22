-- #1401: remove 'identity' and 'soul' from the entry_type enum.
--
-- The enum type cannot be altered to drop values in place, so it is recreated.
-- The diary_search() function depends on entry_type (parameter + return column),
-- so it must be dropped before the type and recreated afterward against the new
-- type. Existing diary_entries rows of the removed types are remapped to
-- 'semantic' while the column is plain text, so the cast back to the recreated
-- enum succeeds without dropping data.
DROP FUNCTION IF EXISTS diary_search(TEXT, vector(384), INT, UUID[], TEXT[], INT, FLOAT, FLOAT, FLOAT, entry_type[], TEXT[], BOOLEAN, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ, UUID[]);--> statement-breakpoint
ALTER TABLE "diary_entries" ALTER COLUMN "entry_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "diary_entries" ALTER COLUMN "entry_type" SET DEFAULT 'semantic'::text;--> statement-breakpoint
-- This one-time compatibility rewrite changes only the enum label for
-- historical identity/soul entries. Signed rows must survive it, so bypass the
-- content immutability trigger for this statement and restore it immediately.
ALTER TABLE "diary_entries" DISABLE TRIGGER "diary_entries_immutable_content";--> statement-breakpoint
UPDATE "diary_entries" SET "entry_type" = 'semantic' WHERE "entry_type" IN ('identity', 'soul');--> statement-breakpoint
ALTER TABLE "diary_entries" ENABLE TRIGGER "diary_entries_immutable_content";--> statement-breakpoint
DROP TYPE "public"."entry_type";--> statement-breakpoint
CREATE TYPE "public"."entry_type" AS ENUM('episodic', 'semantic', 'procedural', 'reflection');--> statement-breakpoint
ALTER TABLE "diary_entries" ALTER COLUMN "entry_type" SET DEFAULT 'semantic'::"public"."entry_type";--> statement-breakpoint
ALTER TABLE "diary_entries" ALTER COLUMN "entry_type" SET DATA TYPE "public"."entry_type" USING "entry_type"::"public"."entry_type";--> statement-breakpoint
-- Recompile the signed-content guard after recreating entry_type. The function
-- body references NEW.entry_type/OLD.entry_type, and existing PL/pgSQL cached
-- plans can retain the dropped enum type OID.
CREATE OR REPLACE FUNCTION prevent_signed_content_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.content_signature IS NOT NULL THEN
    IF NEW.title IS DISTINCT FROM OLD.title
       OR NEW.content IS DISTINCT FROM OLD.content
       OR NEW.tags IS DISTINCT FROM OLD.tags
       OR NEW.entry_type IS DISTINCT FROM OLD.entry_type
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
       OR NEW.content_signature IS DISTINCT FROM OLD.content_signature
       OR NEW.signing_nonce IS DISTINCT FROM OLD.signing_nonce THEN
      RAISE EXCEPTION
        'Cannot modify content of a signed diary entry. Create a new entry and relate it with a supersedes relation.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- Recreate diary_search() verbatim (definition from 0013) so it binds to the
-- recreated entry_type. No behavioral change.
CREATE OR REPLACE FUNCTION diary_search(
  p_query TEXT,
  p_embedding vector(384),
  p_limit INT DEFAULT 10,
  p_diary_ids UUID[] DEFAULT NULL,
  p_tags TEXT[] DEFAULT NULL,
  p_rrf_k INT DEFAULT 60,
  p_w_relevance FLOAT DEFAULT 1.0,
  p_w_recency FLOAT DEFAULT 0.0,
  p_w_importance FLOAT DEFAULT 0.0,
  p_entry_types entry_type[] DEFAULT NULL,
  p_exclude_tags TEXT[] DEFAULT NULL,
  p_exclude_superseded BOOLEAN DEFAULT FALSE,
  p_exclude_suspicious BOOLEAN DEFAULT FALSE,
  p_created_before TIMESTAMPTZ DEFAULT NULL,
  p_created_after TIMESTAMPTZ DEFAULT NULL,
  p_team_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  diary_id UUID,
  creator_agent_id UUID,
  creator_human_id UUID,
  title VARCHAR(255),
  content TEXT,
  tags TEXT[],
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  vector_rrf FLOAT,
  fts_rrf FLOAT,
  combined_score FLOAT,
  author_fingerprint VARCHAR(19),
  author_public_key TEXT,
  importance SMALLINT,
  entry_type entry_type,
  access_count INTEGER,
  last_accessed_at TIMESTAMPTZ,
  injection_risk BOOLEAN,
  content_hash VARCHAR(100),
  content_signature TEXT,
  signing_nonce UUID
) AS $$
DECLARE
  v_tsquery tsquery;
  v_has_negation BOOLEAN := false;
  v_vector_max_distance FLOAT := 0.6;
BEGIN
  IF p_query IS NOT NULL AND p_query != '' THEN
    v_tsquery := websearch_to_tsquery('english', p_query);
    v_has_negation := v_tsquery::text LIKE '%!%';
  END IF;

  RETURN QUERY
  WITH vector_cte AS (
    SELECT
      de.id,
      ROW_NUMBER() OVER (ORDER BY de.embedding <=> p_embedding) AS rank
    FROM diary_entries de
    JOIN diaries dia ON dia.id = de.diary_id
    WHERE p_embedding IS NOT NULL
      AND de.embedding IS NOT NULL
      AND (de.embedding <=> p_embedding) <= v_vector_max_distance
      AND (
        (p_diary_ids IS NOT NULL AND de.diary_id = ANY(p_diary_ids))
        OR (p_team_ids IS NOT NULL AND dia.team_id = ANY(p_team_ids))
        OR (p_diary_ids IS NULL AND p_team_ids IS NULL AND dia.visibility = 'public')
      )
      AND (p_tags IS NULL OR de.tags @> p_tags)
      AND (
        p_exclude_tags IS NULL
        OR de.tags IS NULL
        OR NOT (de.tags && p_exclude_tags)
      )
      AND (p_entry_types IS NULL OR de.entry_type = ANY(p_entry_types))
      AND (
        NOT p_exclude_superseded
        OR NOT EXISTS (
          SELECT 1
          FROM entry_relations er
          WHERE er.target_id = de.id
            AND er.relation = 'supersedes'
            AND er.status = 'accepted'
        )
      )
      AND (NOT p_exclude_suspicious OR de.injection_risk = FALSE)
      AND (p_created_before IS NULL OR de.created_at < p_created_before)
      AND (p_created_after IS NULL OR de.created_at >= p_created_after)
    ORDER BY de.embedding <=> p_embedding
    LIMIT p_limit * 2
  ),
  fts_cte AS (
    SELECT
      sub.id,
      ROW_NUMBER() OVER (ORDER BY sub.rank_score DESC) AS rank
    FROM (
      SELECT
        de.id,
        ts_rank(diary_entry_tsv(de.title, de.content, de.tags), v_tsquery) AS rank_score
      FROM diary_entries de
      JOIN diaries dia ON dia.id = de.diary_id
      WHERE v_tsquery IS NOT NULL
        AND diary_entry_tsv(de.title, de.content, de.tags) @@ v_tsquery
        AND (
          (p_diary_ids IS NOT NULL AND de.diary_id = ANY(p_diary_ids))
          OR (p_team_ids IS NOT NULL AND dia.team_id = ANY(p_team_ids))
          OR (p_diary_ids IS NULL AND p_team_ids IS NULL AND dia.visibility = 'public')
        )
        AND (p_tags IS NULL OR de.tags @> p_tags)
        AND (
          p_exclude_tags IS NULL
          OR de.tags IS NULL
          OR NOT (de.tags && p_exclude_tags)
        )
        AND (p_entry_types IS NULL OR de.entry_type = ANY(p_entry_types))
        AND (
          NOT p_exclude_superseded
          OR NOT EXISTS (
            SELECT 1
            FROM entry_relations er
            WHERE er.target_id = de.id
              AND er.relation = 'supersedes'
              AND er.status = 'accepted'
          )
        )
        AND (NOT p_exclude_suspicious OR de.injection_risk = FALSE)
        AND (p_created_before IS NULL OR de.created_at < p_created_before)
        AND (p_created_after IS NULL OR de.created_at >= p_created_after)
      ORDER BY rank_score DESC
      LIMIT p_limit * 2
    ) sub
  ),
  rrf AS (
    SELECT
      COALESCE(v.id, f.id) AS id,
      COALESCE(1.0 / (p_rrf_k + v.rank), 0)::FLOAT AS vector_rrf,
      COALESCE(1.0 / (p_rrf_k + f.rank), 0)::FLOAT AS fts_rrf,
      (
        COALESCE(1.0 / (p_rrf_k + v.rank), 0)
        + COALESCE(1.0 / (p_rrf_k + f.rank), 0)
      )::FLOAT AS rrf_combined
    FROM vector_cte v
    FULL OUTER JOIN fts_cte f ON v.id = f.id
  ),
  scored AS (
    SELECT
      r.id,
      r.vector_rrf,
      r.fts_rrf,
      (
        r.rrf_combined / NULLIF((2.0 / (p_rrf_k + 1)), 0)
      )::FLOAT AS relevance_score
    FROM rrf r
    WHERE r.rrf_combined > 0
  )
  SELECT
    de.id,
    de.diary_id,
    de.creator_agent_id,
    de.creator_human_id,
    de.title,
    de.content,
    de.tags,
    de.created_at,
    de.updated_at,
    s.vector_rrf,
    s.fts_rrf,
    (
      p_w_relevance * s.relevance_score
      + p_w_recency * power(
        0.99,
        EXTRACT(EPOCH FROM (now() - COALESCE(de.last_accessed_at, de.created_at))) / 3600.0
      )
      + p_w_importance * (de.importance / 10.0)
    )::FLOAT AS combined_score,
    CASE
      WHEN p_diary_ids IS NULL AND p_team_ids IS NULL THEN ak.fingerprint
      ELSE NULL
    END AS author_fingerprint,
    CASE
      WHEN p_diary_ids IS NULL AND p_team_ids IS NULL THEN ak.public_key
      ELSE NULL
    END AS author_public_key,
    de.importance,
    de.entry_type,
    de.access_count,
    de.last_accessed_at,
    de.injection_risk,
    de.content_hash,
    de.content_signature,
    de.signing_nonce
  FROM scored s
  JOIN diary_entries de ON de.id = s.id
  JOIN diaries dia ON dia.id = de.diary_id
  LEFT JOIN agents ak ON ak.identity_id = dia.creator_agent_id
  WHERE (
      NOT v_has_negation
      OR diary_entry_tsv(de.title, de.content, de.tags) @@ v_tsquery
    )
    AND (
      p_exclude_tags IS NULL
      OR de.tags IS NULL
      OR NOT (de.tags && p_exclude_tags)
    )
  ORDER BY combined_score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
