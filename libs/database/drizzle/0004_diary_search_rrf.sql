-- ============================================================================
-- Migration: diary_search_rrf
-- Replaces hybrid_search() with diary_search() using Reciprocal Rank Fusion
-- Upgrades FTS index to cover title + content + tags
-- ============================================================================

-- Drop old function and its comment
DROP FUNCTION IF EXISTS hybrid_search(UUID, TEXT, vector(384), INT, FLOAT, FLOAT);

-- ============================================================================
-- diary_search() — RRF-based hybrid retrieval
-- ============================================================================
CREATE OR REPLACE FUNCTION diary_search(
    p_query TEXT,
    p_embedding vector(384),
    p_limit INT DEFAULT 10,
    p_owner_id UUID DEFAULT NULL,
    p_tags TEXT[] DEFAULT NULL,
    p_rrf_k INT DEFAULT 60
)
RETURNS TABLE (
    id UUID,
    owner_id UUID,
    title VARCHAR(255),
    content TEXT,
    visibility visibility,
    tags TEXT[],
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    vector_rrf FLOAT,
    fts_rrf FLOAT,
    combined_score FLOAT,
    author_fingerprint VARCHAR(19),
    author_public_key TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH vector_cte AS (
        SELECT
            d.id,
            ROW_NUMBER() OVER (ORDER BY d.embedding <=> p_embedding) AS rank
        FROM diary_entries d
        WHERE p_embedding IS NOT NULL
          AND d.embedding IS NOT NULL
          AND (
              (p_owner_id IS NOT NULL AND d.owner_id = p_owner_id)
              OR
              (p_owner_id IS NULL AND d.visibility = 'public')
          )
          AND (p_tags IS NULL OR d.tags && p_tags)
        ORDER BY d.embedding <=> p_embedding
        LIMIT p_limit * 2
    ),
    fts_cte AS (
        SELECT
            sub.id,
            ROW_NUMBER() OVER (ORDER BY sub.rank_score DESC) AS rank
        FROM (
            SELECT
                d.id,
                ts_rank(tsv, query) AS rank_score
            FROM diary_entries d,
                 LATERAL to_tsvector('english', coalesce(d.title, '') || ' ' || d.content || ' ' || coalesce(array_to_string(d.tags, ' '), '')) AS tsv,
                 LATERAL plainto_tsquery('english', p_query) AS query
            WHERE p_query IS NOT NULL
              AND p_query != ''
              AND tsv @@ query
              AND (
                  (p_owner_id IS NOT NULL AND d.owner_id = p_owner_id)
                  OR
                  (p_owner_id IS NULL AND d.visibility = 'public')
              )
              AND (p_tags IS NULL OR d.tags && p_tags)
            ORDER BY rank_score DESC
            LIMIT p_limit * 2
        ) sub
    ),
    rrf AS (
        SELECT
            COALESCE(v.id, f.id) AS id,
            COALESCE(1.0 / (p_rrf_k + v.rank), 0)::FLOAT AS vector_rrf,
            COALESCE(1.0 / (p_rrf_k + f.rank), 0)::FLOAT AS fts_rrf,
            (COALESCE(1.0 / (p_rrf_k + v.rank), 0) + COALESCE(1.0 / (p_rrf_k + f.rank), 0))::FLOAT AS combined_score
        FROM vector_cte v
        FULL OUTER JOIN fts_cte f ON v.id = f.id
    )
    SELECT
        d.id,
        d.owner_id,
        d.title,
        d.content,
        d.visibility,
        d.tags,
        d.created_at,
        d.updated_at,
        r.vector_rrf,
        r.fts_rrf,
        r.combined_score,
        CASE WHEN p_owner_id IS NULL THEN ak.fingerprint ELSE NULL END AS author_fingerprint,
        CASE WHEN p_owner_id IS NULL THEN ak.public_key ELSE NULL END AS author_public_key
    FROM rrf r
    JOIN diary_entries d ON d.id = r.id
    LEFT JOIN agent_keys ak ON ak.identity_id = d.owner_id
    ORDER BY r.combined_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION diary_search IS 'Unified search with RRF scoring. NULL owner_id = public mode, non-NULL = owner-scoped.';

-- ============================================================================
-- Upgrade FTS index to cover title + content + tags
-- ============================================================================
DROP INDEX IF EXISTS diary_entries_content_fts_idx;

CREATE INDEX diary_entries_fts_idx ON diary_entries USING gin(
    to_tsvector('english', coalesce(title, '') || ' ' || content || ' ' || coalesce(array_to_string(tags, ' '), ''))
);
