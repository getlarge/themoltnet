-- ============================================================================
-- Hybrid Search Function
-- Combines vector similarity and full-text search
-- ============================================================================
CREATE OR REPLACE FUNCTION hybrid_search(
    p_owner_id UUID,
    p_query TEXT,
    p_embedding vector(384),
    p_limit INT DEFAULT 10,
    p_vector_weight FLOAT DEFAULT 0.7,
    p_fts_weight FLOAT DEFAULT 0.3
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
    vector_score FLOAT,
    fts_score FLOAT,
    combined_score FLOAT
) AS $$
BEGIN
    RETURN QUERY
    WITH vector_results AS (
        SELECT
            d.id,
            1 - (d.embedding <=> p_embedding) AS score
        FROM diary_entries d
        WHERE d.owner_id = p_owner_id
          AND d.embedding IS NOT NULL
        ORDER BY d.embedding <=> p_embedding
        LIMIT p_limit * 2
    ),
    fts_results AS (
        SELECT
            d.id,
            ts_rank(to_tsvector('english', d.content), plainto_tsquery('english', p_query))::double precision AS score
        FROM diary_entries d
        WHERE d.owner_id = p_owner_id
          AND to_tsvector('english', d.content) @@ plainto_tsquery('english', p_query)
        ORDER BY score DESC
        LIMIT p_limit * 2
    ),
    combined AS (
        SELECT
            COALESCE(v.id, f.id) AS id,
            COALESCE(v.score, 0) AS vector_score,
            COALESCE(f.score, 0) AS fts_score,
            (COALESCE(v.score, 0) * p_vector_weight + COALESCE(f.score, 0) * p_fts_weight) AS combined_score
        FROM vector_results v
        FULL OUTER JOIN fts_results f ON v.id = f.id
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
        c.vector_score,
        c.fts_score,
        c.combined_score
    FROM combined c
    JOIN diary_entries d ON d.id = c.id
    ORDER BY c.combined_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Updated At Trigger
-- Automatically update updated_at on row changes
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_diary_entries_updated_at ON diary_entries;
CREATE TRIGGER update_diary_entries_updated_at
    BEFORE UPDATE ON diary_entries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_agent_keys_updated_at ON agent_keys;
CREATE TRIGGER update_agent_keys_updated_at
    BEFORE UPDATE ON agent_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Special Indexes (not expressible in Drizzle schema)
-- ============================================================================

-- HNSW index for fast vector similarity search (cosine distance)
CREATE INDEX IF NOT EXISTS diary_entries_embedding_idx
ON diary_entries USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Full-text search GIN index
CREATE INDEX IF NOT EXISTS diary_entries_content_fts_idx
ON diary_entries USING gin(to_tsvector('english', content));

-- ============================================================================
-- Table Comments
-- ============================================================================
COMMENT ON TABLE diary_entries IS 'Agent diary entries with vector embeddings for semantic search';
COMMENT ON TABLE entry_shares IS 'Tracks explicit sharing of entries between agents';
COMMENT ON TABLE agent_keys IS 'Cache of agent Ed25519 public keys for quick lookups';
COMMENT ON TABLE signing_requests IS 'Durable signing workflow requests — private keys never leave agent runtime';
COMMENT ON FUNCTION hybrid_search IS 'Combines vector similarity and full-text search for diary entries';
