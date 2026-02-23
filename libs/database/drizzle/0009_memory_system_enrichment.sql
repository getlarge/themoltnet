-- ============================================================================
-- Migration: memory_system_enrichment
-- Adds memory system columns (importance, access tracking, entry types,
-- supersession) to diary_entries and replaces diary_search() with a version
-- that supports weighted scoring, entry-type filtering, and supersession
-- exclusion.
-- ============================================================================

-- 1. Create entry_type enum
CREATE TYPE "public"."entry_type" AS ENUM('episodic', 'semantic', 'procedural', 'reflection', 'identity', 'soul');
--> statement-breakpoint

-- 2. Add new columns to diary_entries
ALTER TABLE "diary_entries" ADD COLUMN "importance" smallint NOT NULL DEFAULT 5;
--> statement-breakpoint
ALTER TABLE "diary_entries" ADD COLUMN "access_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "diary_entries" ADD COLUMN "last_accessed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "diary_entries" ADD COLUMN "entry_type" "entry_type" NOT NULL DEFAULT 'semantic';
--> statement-breakpoint
ALTER TABLE "diary_entries" ADD COLUMN "superseded_by" uuid;
--> statement-breakpoint

-- 3. Foreign key for superseded_by (self-referencing)
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_superseded_by_diary_entries_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."diary_entries"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- 4. CHECK constraint on importance (1-10)
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_importance_check" CHECK (importance >= 1 AND importance <= 10);
--> statement-breakpoint

-- 5. Index on entry_type
CREATE INDEX "diary_entries_entry_type_idx" ON "diary_entries" USING btree ("entry_type");
--> statement-breakpoint

-- 6. Partial index on superseded_by (only non-null rows)
CREATE INDEX "diary_entries_superseded_by_idx" ON "diary_entries" USING btree ("superseded_by") WHERE superseded_by IS NOT NULL;
--> statement-breakpoint

-- 7. Data migration: infer entry_type from system tags
UPDATE "diary_entries" SET "entry_type" = 'identity' WHERE tags @> ARRAY['system:identity'];
--> statement-breakpoint
UPDATE "diary_entries" SET "entry_type" = 'soul' WHERE tags @> ARRAY['system:soul'];
--> statement-breakpoint

-- 8. Drop old diary_search() with exact current signature
DROP FUNCTION IF EXISTS diary_search(TEXT, vector(384), INT, UUID, TEXT[], INT);
--> statement-breakpoint

-- 9. Create new diary_search() with weighted scoring and filtering
CREATE OR REPLACE FUNCTION diary_search(
    p_query TEXT,
    p_embedding vector(384),
    p_limit INT DEFAULT 10,
    p_owner_id UUID DEFAULT NULL,
    p_tags TEXT[] DEFAULT NULL,
    p_rrf_k INT DEFAULT 60,
    p_w_relevance FLOAT DEFAULT 1.0,
    p_w_recency FLOAT DEFAULT 0.0,
    p_w_importance FLOAT DEFAULT 0.0,
    p_entry_types entry_type[] DEFAULT NULL,
    p_exclude_superseded BOOLEAN DEFAULT FALSE
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
    author_public_key TEXT,
    importance SMALLINT,
    entry_type entry_type,
    superseded_by UUID,
    access_count INTEGER,
    last_accessed_at TIMESTAMPTZ
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
          AND (p_tags IS NULL OR d.tags @> p_tags)
          AND (p_entry_types IS NULL OR d.entry_type = ANY(p_entry_types))
          AND (NOT p_exclude_superseded OR d.superseded_by IS NULL)
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
                 LATERAL diary_entry_tsv(d.title, d.content, d.tags) AS tsv,
                 LATERAL websearch_to_tsquery('english', p_query) AS query
            WHERE p_query IS NOT NULL
              AND p_query != ''
              AND tsv @@ query
              AND (
                  (p_owner_id IS NOT NULL AND d.owner_id = p_owner_id)
                  OR
                  (p_owner_id IS NULL AND d.visibility = 'public')
              )
              AND (p_tags IS NULL OR d.tags @> p_tags)
              AND (p_entry_types IS NULL OR d.entry_type = ANY(p_entry_types))
              AND (NOT p_exclude_superseded OR d.superseded_by IS NULL)
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
        (p_w_relevance * r.rrf_combined
         + p_w_recency * power(0.99, EXTRACT(EPOCH FROM (now() - COALESCE(d.last_accessed_at, d.created_at))) / 3600.0)
         + p_w_importance * (d.importance / 10.0))::FLOAT AS combined_score,
        CASE WHEN p_owner_id IS NULL THEN ak.fingerprint ELSE NULL END AS author_fingerprint,
        CASE WHEN p_owner_id IS NULL THEN ak.public_key ELSE NULL END AS author_public_key,
        d.importance,
        d.entry_type,
        d.superseded_by,
        d.access_count,
        d.last_accessed_at
    FROM rrf r
    JOIN diary_entries d ON d.id = r.id
    LEFT JOIN agent_keys ak ON ak.identity_id = d.owner_id
    ORDER BY combined_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
