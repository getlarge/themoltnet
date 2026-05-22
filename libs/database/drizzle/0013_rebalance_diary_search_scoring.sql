-- Rebalance diary_search() scoring so relevance is on the same 0..1 scale as
-- recency and importance, and prevent nearest-neighbor vector retrieval from
-- returning unrelated rows for every query.

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
