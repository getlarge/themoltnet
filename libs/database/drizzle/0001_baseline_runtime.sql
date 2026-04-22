-- Runtime SQL baseline layered on top of 0000_init.sql.
--
-- 0000_init is generated from schema.ts and covers everything Drizzle can
-- express directly. This file captures the rest of the production shape:
-- extensions, helper functions, triggers, special indexes, and retention
-- guardrails.

CREATE SCHEMA IF NOT EXISTS dbos;

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_diary_entries_updated_at ON "diary_entries";
CREATE TRIGGER update_diary_entries_updated_at
  BEFORE UPDATE ON "diary_entries"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_agents_updated_at ON "agents";
CREATE TRIGGER update_agents_updated_at
  BEFORE UPDATE ON "agents"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_humans_updated_at ON "humans";
CREATE TRIGGER update_humans_updated_at
  BEFORE UPDATE ON "humans"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION diary_entry_tsv(
  p_title TEXT,
  p_content TEXT,
  p_tags TEXT[]
)
RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$fn$
  SELECT to_tsvector(
    'english'::regconfig,
    coalesce(p_title, '')
      || ' '
      || p_content
      || ' '
      || coalesce(array_to_string(p_tags, ' '), '')
  );
$fn$;

CREATE INDEX IF NOT EXISTS diary_entries_embedding_idx
ON "diary_entries" USING hnsw ("embedding" vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS diary_entries_fts_idx
ON "diary_entries" USING gin(diary_entry_tsv("title", "content", "tags"));

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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS diary_entries_immutable_content ON "diary_entries";
CREATE TRIGGER diary_entries_immutable_content
  BEFORE UPDATE ON "diary_entries"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_signed_content_update();

CREATE OR REPLACE FUNCTION prevent_signed_entry_deletion()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.content_signature IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot delete a content-signed diary entry. Create a new entry and relate it with a supersedes relation instead.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS diary_entries_no_signed_delete ON "diary_entries";
CREATE TRIGGER diary_entries_no_signed_delete
  BEFORE DELETE ON "diary_entries"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_signed_entry_deletion();

ALTER TABLE "context_packs"
  ADD CONSTRAINT "context_packs_pin_expiry_ck"
  CHECK (
    ("pinned" = true AND "expires_at" IS NULL)
    OR
    ("pinned" = false AND "expires_at" IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION enforce_context_pack_retention()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.pinned = true THEN
    NEW.expires_at := NULL;
  END IF;

  IF NEW.pinned = false AND NEW.expires_at IS NULL THEN
    RAISE EXCEPTION
      'Non-pinned context packs must have expires_at';
  END IF;

  IF NEW.pinned = false AND NEW.expires_at <= now() THEN
    RAISE EXCEPTION
      'expires_at must be in the future for non-pinned context packs';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS context_packs_retention_guard ON "context_packs";
CREATE TRIGGER context_packs_retention_guard
  BEFORE INSERT OR UPDATE OF "pinned", "expires_at"
  ON "context_packs"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_context_pack_retention();

CREATE INDEX IF NOT EXISTS idx_entry_relations_supersedes_target
ON "entry_relations" ("target_id")
WHERE "relation" = 'supersedes' AND "status" = 'accepted';

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
  created_by UUID,
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
  )
  SELECT
    de.id,
    de.diary_id,
    de.created_by,
    de.title,
    de.content,
    de.tags,
    de.created_at,
    de.updated_at,
    r.vector_rrf,
    r.fts_rrf,
    (
      p_w_relevance * r.rrf_combined
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
  FROM rrf r
  JOIN diary_entries de ON de.id = r.id
  JOIN diaries dia ON dia.id = de.diary_id
  LEFT JOIN agents ak ON ak.identity_id = dia.created_by
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

COMMENT ON TABLE "agents" IS
  'Cache of agent Ed25519 public keys for quick lookups';
COMMENT ON TABLE "humans" IS
  'Minimal record for human users created during Kratos self-service registration';
COMMENT ON FUNCTION diary_search IS
  'Hybrid diary retrieval with RRF scoring, team scoping, and provenance projection.';
