-- Decouple agents from Ory Kratos identity IDs.
--
-- `agents.identity_id` was the primary key, so a Kratos identity ID was at once
-- MoltNet's internal agent ID, the target of 21 foreign keys, the Keto subject
-- (`Agent:<uuid>`) and the join key in Hydra client metadata. Deleting
-- identities upstream left every reference pointing at something Ory no longer
-- knew about, and recovery was impossible without rewriting the graph, because
-- restored identities get new UUIDs (incident 2026-09-04).
--
-- `agents.id` is a FRESH random UUID, exactly as a new registration produces.
-- Seeding it from `identity_id` would have avoided rewriting references, but it
-- would also leave every existing agent on the `id == identity_id` path — the
-- one path where code that conflates the two still appears to work. Making them
-- diverge immediately means any such code fails loudly now rather than on the
-- first new registration.
--
-- Consequence: the 21 referencing columns are rewritten here, and the 758 Keto
-- `Agent:<uuid>` tuples must be rewritten from `identity_id` to `agents.id`
-- immediately afterwards. Until that runs, agents authenticate but resolve no
-- permissions, so this migration and the Keto rewrite belong inside one
-- maintenance window.
--
-- NOTE: drizzle-kit generated a destructive version of this migration and
-- emitted DROP statements using only its own naming convention. Production
-- carries a mix of drizzle-style names, Postgres `_fkey` defaults and at least
-- one truncated at the 63-character identifier limit, so constraints are
-- dropped by their DISCOVERED name and recreated under drizzle's canonical
-- `<table>_<column>_agents_id_fk`.

-- A fresh identifier per agent, matching what registration generates.
ALTER TABLE "agents" ADD COLUMN "id" uuid NOT NULL DEFAULT gen_random_uuid();--> statement-breakpoint

-- Capture each FK targeting agents(identity_id) with its REAL name and delete
-- rule before dropping anything.
CREATE TEMP TABLE "_fk_backup" AS
SELECT tc.constraint_name, tc.table_name, kcu.column_name, rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
 AND ccu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints rc
  ON rc.constraint_name = tc.constraint_name
 AND rc.constraint_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name = 'agents'
  AND ccu.column_name = 'identity_id';--> statement-breakpoint

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM "_fk_backup";
  IF n = 0 THEN
    RAISE EXCEPTION 'No foreign keys target agents(identity_id); refusing to continue';
  END IF;
  RAISE NOTICE 'Repointing % foreign keys to agents(id)', n;
END $$;--> statement-breakpoint

-- Drop first: the child values still match identity_id, so rewriting them
-- while the old constraints stand would violate them.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM "_fk_backup" LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.table_name, r.constraint_name);
  END LOOP;
END $$;--> statement-breakpoint

-- Rewrite every referencing column from the Kratos identity to the new
-- internal id.
DO $$
DECLARE r record; moved bigint; total bigint := 0;
BEGIN
  FOR r IN SELECT * FROM "_fk_backup" LOOP
    EXECUTE format(
      'UPDATE %I c SET %I = a."id" FROM "agents" a WHERE c.%I = a."identity_id"',
      r.table_name, r.column_name, r.column_name);
    GET DIAGNOSTICS moved = ROW_COUNT;
    total := total + moved;
  END LOOP;
  RAISE NOTICE 'Repointed % referencing row(s)', total;
END $$;--> statement-breakpoint

-- Swap the primary key. The old name is resolved dynamically; drizzle-kit
-- could not determine it.
DO $$
DECLARE pk_name text;
BEGIN
  SELECT tc.constraint_name INTO pk_name
  FROM information_schema.table_constraints tc
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'agents'
    AND tc.constraint_type = 'PRIMARY KEY';
  IF pk_name IS NULL THEN
    RAISE EXCEPTION 'agents primary key not found; refusing to continue';
  END IF;
  EXECUTE format('ALTER TABLE "agents" DROP CONSTRAINT %I', pk_name);
END $$;--> statement-breakpoint

ALTER TABLE "agents" ADD CONSTRAINT "agents_pkey" PRIMARY KEY ("id");--> statement-breakpoint

-- identity_id becomes optional: NULL means "no live Kratos identity", and the
-- agent keeps its data, ownership and permissions regardless.
ALTER TABLE "agents" ALTER COLUMN "identity_id" DROP NOT NULL;--> statement-breakpoint

ALTER TABLE "agents" ADD CONSTRAINT "agents_identity_id_unique" UNIQUE("identity_id");--> statement-breakpoint

-- Recreate under drizzle's canonical name, preserving the original delete rule
-- and deliberately WITHOUT ON UPDATE CASCADE: agents.id is immutable by design,
-- so cascade would be inert at best and would silently rewrite 21 tables on a
-- stray UPDATE at worst.
DO $$
DECLARE r record; new_name text;
BEGIN
  FOR r IN SELECT * FROM "_fk_backup" LOOP
    new_name := left(r.table_name || '_' || r.column_name || '_agents_id_fk', 63);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES "agents"("id") ON DELETE %s',
      r.table_name, new_name, r.column_name, r.delete_rule);
  END LOOP;
END $$;--> statement-breakpoint

-- Post-conditions: fail rather than leave a half-migrated graph.
DO $$
DECLARE still_seeded bigint; retargeted bigint; expected bigint; leftover bigint;
        r record; orphans bigint; total_orphans bigint := 0;
BEGIN
  SELECT count(*) INTO expected FROM "_fk_backup";

  -- Every agent must have diverged from its Kratos identity.
  SELECT count(*) INTO still_seeded FROM "agents" WHERE "id" = "identity_id";
  IF still_seeded > 0 THEN
    RAISE EXCEPTION '% agent(s) still carry id = identity_id', still_seeded;
  END IF;

  SELECT count(*) INTO leftover
  FROM information_schema.constraint_column_usage ccu
  JOIN information_schema.table_constraints tc
    ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
  WHERE ccu.table_name = 'agents' AND ccu.column_name = 'identity_id'
    AND tc.constraint_type = 'FOREIGN KEY';
  IF leftover > 0 THEN
    RAISE EXCEPTION '% foreign key(s) still target agents(identity_id)', leftover;
  END IF;

  SELECT count(*) INTO retargeted
  FROM information_schema.constraint_column_usage ccu
  JOIN information_schema.table_constraints tc
    ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
  WHERE ccu.table_name = 'agents' AND ccu.column_name = 'id'
    AND tc.constraint_type = 'FOREIGN KEY';
  IF retargeted <> expected THEN
    RAISE EXCEPTION 'Expected % foreign keys on agents(id), found %', expected, retargeted;
  END IF;

  -- No referencing row may have been left behind by the rewrite.
  FOR r IN SELECT * FROM "_fk_backup" LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I c LEFT JOIN "agents" a ON a."id" = c.%I WHERE c.%I IS NOT NULL AND a."id" IS NULL',
      r.table_name, r.column_name, r.column_name) INTO orphans;
    IF orphans > 0 THEN
      RAISE EXCEPTION '%.% has % orphaned reference(s) after rewrite',
        r.table_name, r.column_name, orphans;
    END IF;
    total_orphans := total_orphans + orphans;
  END LOOP;

  RAISE NOTICE 'Decoupling complete: % foreign keys on agents(id), 0 orphans', retargeted;
END $$;--> statement-breakpoint

DROP TABLE "_fk_backup";--> statement-breakpoint

-- Repoint diary_search's author join at agents.id.
--
-- The retarget above rewrote the 21 referencing COLUMNS. `diary_search` is a
-- stored function, so it was invisible to a foreign-key-driven rewrite and
-- kept joining `agents ak ON ak.identity_id = dia.creator_agent_id` — a
-- predicate that matches nothing once creator_agent_id holds an agents.id.
--
-- It is a LEFT JOIN, so there is no error: every public search result would
-- simply come back with a NULL author fingerprint and public key. Silent
-- unattribution, in a system whose point is attribution.
--
-- Lives in this migration rather than a follow-up so the retarget and the
-- function that depends on it apply as one unit — there is no instant at
-- which the columns are rewritten but search is unattributed.
--
-- The body below is 0022's verbatim, with that one join predicate changed.
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
  LEFT JOIN agents ak ON ak.id = dia.creator_agent_id
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
