-- Add temporal filter parameters (p_created_before, p_created_after) to diary_search() function.
-- Both default to NULL (no filter). Applied in vector_cte and fts_cte WHERE clauses.
--> statement-breakpoint
DROP FUNCTION IF EXISTS diary_search(TEXT, vector(384), INT, UUID[], TEXT[], INT, FLOAT, FLOAT, FLOAT, entry_type[], TEXT[], BOOLEAN, BOOLEAN);
--> statement-breakpoint
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
    p_created_after TIMESTAMPTZ DEFAULT NULL
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
    superseded_by UUID,
    access_count INTEGER,
    last_accessed_at TIMESTAMPTZ,
    injection_risk BOOLEAN,
    content_hash VARCHAR(100),
    content_signature TEXT,
    signing_nonce UUID
) AS $$
DECLARE
    v_tsquery tsquery;
    v_has_negation boolean := false;
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
              OR
              (p_diary_ids IS NULL AND dia.visibility = 'public')
          )
          AND (p_tags IS NULL OR de.tags @> p_tags)
          AND (
              p_exclude_tags IS NULL
              OR de.tags IS NULL
              OR NOT (de.tags && p_exclude_tags)
          )
          AND (p_entry_types IS NULL OR de.entry_type = ANY(p_entry_types))
          AND (NOT p_exclude_superseded OR de.superseded_by IS NULL)
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
                  OR
                  (p_diary_ids IS NULL AND dia.visibility = 'public')
              )
              AND (p_tags IS NULL OR de.tags @> p_tags)
              AND (
                  p_exclude_tags IS NULL
                  OR de.tags IS NULL
                  OR NOT (de.tags && p_exclude_tags)
              )
              AND (p_entry_types IS NULL OR de.entry_type = ANY(p_entry_types))
              AND (NOT p_exclude_superseded OR de.superseded_by IS NULL)
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
            (COALESCE(1.0 / (p_rrf_k + v.rank), 0) + COALESCE(1.0 / (p_rrf_k + f.rank), 0))::FLOAT AS rrf_combined
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
        (p_w_relevance * r.rrf_combined
         + p_w_recency * power(0.99, EXTRACT(EPOCH FROM (now() - COALESCE(de.last_accessed_at, de.created_at))) / 3600.0)
         + p_w_importance * (de.importance / 10.0))::FLOAT AS combined_score,
        CASE WHEN p_diary_ids IS NULL THEN ak.fingerprint ELSE NULL END AS author_fingerprint,
        CASE WHEN p_diary_ids IS NULL THEN ak.public_key ELSE NULL END AS author_public_key,
        de.importance,
        de.entry_type,
        de.superseded_by,
        de.access_count,
        de.last_accessed_at,
        de.injection_risk,
        de.content_hash,
        de.content_signature,
        de.signing_nonce
    FROM rrf r
    JOIN diary_entries de ON de.id = r.id
    JOIN diaries dia ON dia.id = de.diary_id
    LEFT JOIN agent_keys ak ON ak.identity_id = dia.owner_id
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