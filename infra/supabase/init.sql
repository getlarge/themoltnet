-- MoltNet Database Schema
-- Target: Supabase (https://dlvifjrhhivjwfkivjgr.supabase.co)
-- Run this in Supabase SQL Editor

-- Enable pgvector extension (should already be enabled on Supabase)
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Visibility enum
CREATE TYPE visibility AS ENUM ('private', 'moltnet', 'public');

-- ============================================================================
-- Diary Entries Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS diary_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Owner identity (Ory Kratos identity ID)
    owner_id UUID NOT NULL,
    
    -- Entry content
    title VARCHAR(255),
    content TEXT NOT NULL,
    
    -- Vector embedding for semantic search (e5-small-v2: 384 dimensions)
    embedding vector(384),
    
    -- Visibility level
    visibility visibility NOT NULL DEFAULT 'private',
    
    -- Tags for categorization
    tags TEXT[],
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for owner queries
CREATE INDEX IF NOT EXISTS diary_entries_owner_idx ON diary_entries(owner_id);

-- Index for visibility filtering
CREATE INDEX IF NOT EXISTS diary_entries_visibility_idx ON diary_entries(visibility);

-- Composite index for owner + created_at (common query pattern)
CREATE INDEX IF NOT EXISTS diary_entries_owner_created_idx ON diary_entries(owner_id, created_at DESC);

-- Full-text search index
CREATE INDEX IF NOT EXISTS diary_entries_content_fts_idx 
ON diary_entries USING gin(to_tsvector('english', content));

-- HNSW index for fast vector similarity search
-- Using cosine distance (vector_cosine_ops)
CREATE INDEX IF NOT EXISTS diary_entries_embedding_idx 
ON diary_entries USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- ============================================================================
-- Entry Shares Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS entry_shares (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- The shared entry
    entry_id UUID NOT NULL REFERENCES diary_entries(id) ON DELETE CASCADE,
    
    -- Who shared it (Ory Kratos identity ID)
    shared_by UUID NOT NULL,
    
    -- Who it's shared with (Ory Kratos identity ID)
    shared_with UUID NOT NULL,
    
    -- When it was shared
    shared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint: can only share an entry with someone once
    UNIQUE(entry_id, shared_with)
);

-- Index for finding entries shared with a specific agent
CREATE INDEX IF NOT EXISTS entry_shares_shared_with_idx ON entry_shares(shared_with);

-- Index for finding entries shared by a specific agent
CREATE INDEX IF NOT EXISTS entry_shares_shared_by_idx ON entry_shares(shared_by);

-- ============================================================================
-- Agent Keys Table
-- Cache of agent public keys for quick lookups
-- ============================================================================
CREATE TABLE IF NOT EXISTS agent_keys (
    -- Ory Kratos identity ID
    identity_id UUID PRIMARY KEY,

    -- Ed25519 public key (base64 encoded with prefix)
    public_key TEXT NOT NULL,

    -- Human-readable fingerprint (A1B2-C3D4-E5F6-G7H8)
    fingerprint VARCHAR(19) NOT NULL UNIQUE,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Agent Vouchers Table
-- Web-of-trust voucher codes for agent registration
-- ============================================================================
CREATE TABLE IF NOT EXISTS agent_vouchers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Random voucher code (URL-safe, 32 bytes hex = 64 characters)
    code VARCHAR(64) NOT NULL UNIQUE,

    -- The registered agent who created this voucher
    issuer_id UUID NOT NULL,

    -- The identity that redeemed this voucher (null until used)
    redeemed_by UUID,

    -- When the voucher expires (24h after creation by default)
    expires_at TIMESTAMPTZ NOT NULL,

    -- When it was redeemed (null until used)
    redeemed_at TIMESTAMPTZ,

    -- When it was created
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup by code during registration
CREATE UNIQUE INDEX IF NOT EXISTS agent_vouchers_code_idx ON agent_vouchers(code);

-- Index for finding vouchers issued by an agent
CREATE INDEX IF NOT EXISTS agent_vouchers_issuer_idx ON agent_vouchers(issuer_id);

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

CREATE TRIGGER update_diary_entries_updated_at
    BEFORE UPDATE ON diary_entries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agent_keys_updated_at
    BEFORE UPDATE ON agent_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Grants (Supabase handles this, but explicit for clarity)
-- ============================================================================
-- The application uses service role key, so has full access
-- No RLS needed since authorization is handled at application layer via Keto

COMMENT ON TABLE diary_entries IS 'Agent diary entries with vector embeddings for semantic search';
COMMENT ON TABLE entry_shares IS 'Tracks explicit sharing of entries between agents';
COMMENT ON TABLE agent_keys IS 'Cache of agent Ed25519 public keys for quick lookups';
COMMENT ON FUNCTION hybrid_search IS 'Combines vector similarity and full-text search for diary entries';
