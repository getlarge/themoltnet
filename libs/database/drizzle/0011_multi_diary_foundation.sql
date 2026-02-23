CREATE TYPE "public"."diary_share_role" AS ENUM('reader', 'writer');--> statement-breakpoint
CREATE TYPE "public"."diary_share_status" AS ENUM('pending', 'accepted', 'declined', 'revoked');--> statement-breakpoint

CREATE TABLE "diaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"key" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"visibility" "visibility" DEFAULT 'private' NOT NULL,
	"signed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "diary_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"diary_id" uuid NOT NULL,
	"shared_with" uuid NOT NULL,
	"role" "diary_share_role" DEFAULT 'reader' NOT NULL,
	"status" "diary_share_status" DEFAULT 'pending' NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint

ALTER TABLE "diary_entries" ADD COLUMN "diary_id" uuid;--> statement-breakpoint

ALTER TABLE "diary_shares" ADD CONSTRAINT "diary_shares_diary_id_diaries_id_fk" FOREIGN KEY ("diary_id") REFERENCES "public"."diaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_diary_id_diaries_id_fk" FOREIGN KEY ("diary_id") REFERENCES "public"."diaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "diaries_owner_idx" ON "diaries" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "diaries_owner_visibility_idx" ON "diaries" USING btree ("owner_id","visibility");--> statement-breakpoint
CREATE UNIQUE INDEX "diaries_owner_name_unique_idx" ON "diaries" USING btree ("owner_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "diaries_owner_key_unique_idx" ON "diaries" USING btree ("owner_id","key");--> statement-breakpoint

CREATE UNIQUE INDEX "diary_shares_unique_idx" ON "diary_shares" USING btree ("diary_id","shared_with");--> statement-breakpoint
CREATE INDEX "diary_shares_diary_idx" ON "diary_shares" USING btree ("diary_id");--> statement-breakpoint
CREATE INDEX "diary_shares_shared_with_idx" ON "diary_shares" USING btree ("shared_with");--> statement-breakpoint
CREATE INDEX "diary_shares_status_idx" ON "diary_shares" USING btree ("status");--> statement-breakpoint

CREATE INDEX "diary_entries_diary_idx" ON "diary_entries" USING btree ("diary_id");--> statement-breakpoint

-- Backfill: create default diaries per existing owner.
INSERT INTO "diaries" ("owner_id", "key", "name", "visibility")
SELECT DISTINCT owner_id, 'private', 'private', 'private'::"visibility" FROM "diary_entries"
ON CONFLICT ("owner_id", "key") DO NOTHING;--> statement-breakpoint

INSERT INTO "diaries" ("owner_id", "key", "name", "visibility")
SELECT DISTINCT owner_id, 'moltnet', 'moltnet', 'moltnet'::"visibility" FROM "diary_entries"
ON CONFLICT ("owner_id", "key") DO NOTHING;--> statement-breakpoint

INSERT INTO "diaries" ("owner_id", "key", "name", "visibility")
SELECT DISTINCT owner_id, 'public', 'public', 'public'::"visibility" FROM "diary_entries"
ON CONFLICT ("owner_id", "key") DO NOTHING;--> statement-breakpoint

-- Backfill: map entries to matching default diary by previous entry visibility.
UPDATE "diary_entries" de
SET "diary_id" = d."id"
FROM "diaries" d
WHERE de."diary_id" IS NULL
  AND d."owner_id" = de."owner_id"
  AND d."visibility" = de."visibility"
  AND d."key" = de."visibility"::text;--> statement-breakpoint

ALTER TABLE "diary_entries" ALTER COLUMN "diary_id" SET NOT NULL;--> statement-breakpoint

-- Backfill: convert entry-level shares to diary-level accepted reader shares.
INSERT INTO "diary_shares" (
  "diary_id",
  "shared_with",
  "role",
  "status",
  "invited_at",
  "responded_at"
)
SELECT
  d."id" AS diary_id,
  es."shared_with",
  'reader'::"diary_share_role" AS role,
  'accepted'::"diary_share_status" AS status,
  MIN(es."shared_at") AS invited_at,
  MIN(es."shared_at") AS responded_at
FROM "entry_shares" es
JOIN "diary_entries" de ON de."id" = es."entry_id"
JOIN "diaries" d
  ON d."owner_id" = de."owner_id"
 AND d."visibility" = de."visibility"
 AND d."key" = de."visibility"::text
GROUP BY d."id", es."shared_with"
ON CONFLICT ("diary_id", "shared_with") DO UPDATE
SET
  "role" = EXCLUDED."role",
  "status" = EXCLUDED."status";--> statement-breakpoint

-- Keep diary_search output aligned with new non-null diary_id field.
DROP FUNCTION IF EXISTS diary_search(TEXT, vector(384), INT, UUID, TEXT[], INT, FLOAT, FLOAT, FLOAT, entry_type[], BOOLEAN);--> statement-breakpoint

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
    diary_id UUID,
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
        d.diary_id,
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
$$ LANGUAGE plpgsql;--> statement-breakpoint
