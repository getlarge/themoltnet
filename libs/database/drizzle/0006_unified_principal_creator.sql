-- Unified principal (creator) model — paired FK columns + XOR check across 7 tables.
-- See docs/superpowers/plans/2026-05-03-unified-principal-creator-model.md
-- Linked diary entries: c2ec5a9e-7ee5-442e-acb8-38e9c15c0c69 (semantic decision),
-- f1fe4fe6-f9ef-4c9f-be1b-6a79c7816354 (incident).

-- 1. Add new nullable columns to all 7 tables.
ALTER TABLE diaries
  ADD COLUMN creator_agent_id uuid REFERENCES agents(identity_id) ON DELETE RESTRICT,
  ADD COLUMN creator_human_id uuid REFERENCES humans(id) ON DELETE RESTRICT;

ALTER TABLE diary_entries
  ADD COLUMN creator_agent_id uuid REFERENCES agents(identity_id) ON DELETE RESTRICT,
  ADD COLUMN creator_human_id uuid REFERENCES humans(id) ON DELETE RESTRICT;

ALTER TABLE context_packs
  ADD COLUMN creator_agent_id uuid REFERENCES agents(identity_id) ON DELETE RESTRICT,
  ADD COLUMN creator_human_id uuid REFERENCES humans(id) ON DELETE RESTRICT;

ALTER TABLE rendered_packs
  ADD COLUMN creator_agent_id uuid REFERENCES agents(identity_id) ON DELETE RESTRICT,
  ADD COLUMN creator_human_id uuid REFERENCES humans(id) ON DELETE RESTRICT;

ALTER TABLE teams
  ADD COLUMN creator_agent_id uuid REFERENCES agents(identity_id) ON DELETE RESTRICT,
  ADD COLUMN creator_human_id uuid REFERENCES humans(id) ON DELETE RESTRICT;

ALTER TABLE groups
  ADD COLUMN creator_agent_id uuid REFERENCES agents(identity_id) ON DELETE RESTRICT,
  ADD COLUMN creator_human_id uuid REFERENCES humans(id) ON DELETE RESTRICT;

ALTER TABLE team_invites
  ADD COLUMN creator_agent_id uuid REFERENCES agents(identity_id) ON DELETE RESTRICT,
  ADD COLUMN creator_human_id uuid REFERENCES humans(id) ON DELETE RESTRICT;

-- 2. Backfill: every existing created_by UUID is an agent identity_id today
-- (operator-confirmed: no human-created rows exist in production yet).
-- Abort with a clear error if any row would be silently lost — humans created
-- via the REST API today are tracked in `humans` but their `created_by` UUID
-- on these resource tables is the Kratos identity_id. If any such rows exist
-- they require manual backfill against `humans.identity_id` -> `humans.id`.
--
-- NOTE: NOT EXISTS (correlated subquery), not NOT IN (subquery). Postgres
-- treats `x NOT IN (SELECT col FROM t)` as UNKNOWN whenever `col` contains
-- a NULL — meaning the WHERE clause silently drops EVERY row, the orphan
-- count comes back 0, and the backfill UPDATEs run on data that should
-- have aborted. `agents.identity_id` is NOT NULL today, but this migration
-- has to remain correct under any future relaxation of that constraint.
-- NOT EXISTS is unaffected by NULLs and is cheaper besides.
--
-- Each affected table is reported by name in the error message so an
-- operator can run the targeted backfill without grepping for which
-- table tripped the check — the previous version printed a single
-- aggregate count and a literal "<table>" placeholder.
DO $$
DECLARE
  orphan_diaries        integer;
  orphan_diary_entries  integer;
  orphan_context_packs  integer;
  orphan_rendered_packs integer;
  orphan_teams          integer;
  orphan_groups         integer;
  orphan_team_invites   integer;
  affected text[] := ARRAY[]::text[];
BEGIN
  SELECT count(*) INTO orphan_diaries        FROM diaries        d WHERE NOT EXISTS (SELECT 1 FROM agents a WHERE a.identity_id = d.created_by);
  SELECT count(*) INTO orphan_diary_entries  FROM diary_entries  d WHERE NOT EXISTS (SELECT 1 FROM agents a WHERE a.identity_id = d.created_by);
  SELECT count(*) INTO orphan_context_packs  FROM context_packs  d WHERE NOT EXISTS (SELECT 1 FROM agents a WHERE a.identity_id = d.created_by);
  SELECT count(*) INTO orphan_rendered_packs FROM rendered_packs d WHERE NOT EXISTS (SELECT 1 FROM agents a WHERE a.identity_id = d.created_by);
  SELECT count(*) INTO orphan_teams          FROM teams          d WHERE NOT EXISTS (SELECT 1 FROM agents a WHERE a.identity_id = d.created_by);
  SELECT count(*) INTO orphan_groups         FROM groups         d WHERE NOT EXISTS (SELECT 1 FROM agents a WHERE a.identity_id = d.created_by);
  SELECT count(*) INTO orphan_team_invites   FROM team_invites   d WHERE NOT EXISTS (SELECT 1 FROM agents a WHERE a.identity_id = d.created_by);

  IF orphan_diaries        > 0 THEN affected := array_append(affected, format('diaries (%s)',        orphan_diaries));        END IF;
  IF orphan_diary_entries  > 0 THEN affected := array_append(affected, format('diary_entries (%s)',  orphan_diary_entries));  END IF;
  IF orphan_context_packs  > 0 THEN affected := array_append(affected, format('context_packs (%s)',  orphan_context_packs));  END IF;
  IF orphan_rendered_packs > 0 THEN affected := array_append(affected, format('rendered_packs (%s)', orphan_rendered_packs)); END IF;
  IF orphan_teams          > 0 THEN affected := array_append(affected, format('teams (%s)',          orphan_teams));          END IF;
  IF orphan_groups         > 0 THEN affected := array_append(affected, format('groups (%s)',         orphan_groups));         END IF;
  IF orphan_team_invites   > 0 THEN affected := array_append(affected, format('team_invites (%s)',   orphan_team_invites));   END IF;

  IF array_length(affected, 1) > 0 THEN
    -- E'...' (escape-string syntax) on the WHOLE concatenated literal so
    -- the embedded \n sequences are interpreted as newlines. Postgres
    -- only honors backslash escapes inside E'...'; mixing 'plain' and
    -- E'plain' literals across line continuations produces a parse
    -- error at the first non-E continuation, which is what we hit.
    RAISE EXCEPTION E'Migration aborted: rows have created_by values not found in agents. Affected tables: %. If any of these belong to human users, run the following backfill BEFORE re-running this migration (substitute the actual table name from the affected list):\n  UPDATE <affected_table> SET creator_human_id = h.id\n    FROM humans h WHERE h.identity_id = <affected_table>.created_by;\nThen re-run the migration. To inspect the offending rows:\n  SELECT created_by FROM <affected_table>\n    WHERE NOT EXISTS (SELECT 1 FROM agents a WHERE a.identity_id = <affected_table>.created_by);',
      array_to_string(affected, ', ');
  END IF;
END $$;

UPDATE diaries        SET creator_agent_id = created_by;
UPDATE diary_entries  SET creator_agent_id = created_by;
UPDATE context_packs  SET creator_agent_id = created_by;
UPDATE rendered_packs SET creator_agent_id = created_by;
UPDATE teams          SET creator_agent_id = created_by;
UPDATE groups         SET creator_agent_id = created_by;
UPDATE team_invites   SET creator_agent_id = created_by;

-- 3. XOR check constraints (now safe — every row has exactly creator_agent_id set).
ALTER TABLE diaries        ADD CONSTRAINT diaries_creator_xor        CHECK ((creator_agent_id IS NOT NULL) <> (creator_human_id IS NOT NULL));
ALTER TABLE diary_entries  ADD CONSTRAINT diary_entries_creator_xor  CHECK ((creator_agent_id IS NOT NULL) <> (creator_human_id IS NOT NULL));
ALTER TABLE context_packs  ADD CONSTRAINT context_packs_creator_xor  CHECK ((creator_agent_id IS NOT NULL) <> (creator_human_id IS NOT NULL));
ALTER TABLE rendered_packs ADD CONSTRAINT rendered_packs_creator_xor CHECK ((creator_agent_id IS NOT NULL) <> (creator_human_id IS NOT NULL));
ALTER TABLE teams          ADD CONSTRAINT teams_creator_xor          CHECK ((creator_agent_id IS NOT NULL) <> (creator_human_id IS NOT NULL));
ALTER TABLE groups         ADD CONSTRAINT groups_creator_xor         CHECK ((creator_agent_id IS NOT NULL) <> (creator_human_id IS NOT NULL));
ALTER TABLE team_invites   ADD CONSTRAINT team_invites_creator_xor   CHECK ((creator_agent_id IS NOT NULL) <> (creator_human_id IS NOT NULL));

-- 4. Drop the old indexes and columns.
--
-- Index drop ordering: this section drops indexes BEFORE the new ones in
-- step 5 are created. That is intentional — DROP INDEX takes a brief
-- ACCESS EXCLUSIVE lock on the underlying table; sequencing it first
-- (rather than interleaving with CREATE INDEX) keeps the lock window
-- minimal and avoids unrelated CREATE INDEX failures from rolling back
-- a successful drop. There is a small read-perf gap between the drops
-- here and the CREATE INDEX in step 5 — acceptable because: (a) every
-- existing query that targeted the old `created_by` index now targets
-- the new `creator_agent_id` filtered index that planner-rewrites the
-- same way, (b) this migration only runs once per environment, and
-- (c) the table column `created_by` is dropped in this same step, so
-- the old index would be deleted by Postgres on the next ALTER anyway —
-- explicit DROP INDEX just makes the order legible.
DROP INDEX IF EXISTS diaries_created_by_idx;
DROP INDEX IF EXISTS diaries_created_by_visibility_idx;
DROP INDEX IF EXISTS diary_entries_created_by_idx;
DROP INDEX IF EXISTS teams_created_by_idx;

ALTER TABLE diaries        DROP COLUMN created_by;
ALTER TABLE diary_entries  DROP COLUMN created_by;
ALTER TABLE context_packs  DROP COLUMN created_by;
ALTER TABLE rendered_packs DROP COLUMN created_by;
ALTER TABLE teams          DROP COLUMN created_by;
ALTER TABLE groups         DROP COLUMN created_by;
ALTER TABLE team_invites   DROP COLUMN created_by;

-- 5. New filtered indexes mirroring the schema.ts table-level definitions.
CREATE INDEX diaries_creator_agent_idx            ON diaries        (creator_agent_id) WHERE creator_agent_id IS NOT NULL;
CREATE INDEX diaries_creator_human_idx            ON diaries        (creator_human_id) WHERE creator_human_id IS NOT NULL;
CREATE INDEX diaries_creator_agent_visibility_idx ON diaries        (creator_agent_id, visibility) WHERE creator_agent_id IS NOT NULL;

CREATE INDEX diary_entries_creator_agent_idx  ON diary_entries  (creator_agent_id) WHERE creator_agent_id IS NOT NULL;
CREATE INDEX diary_entries_creator_human_idx  ON diary_entries  (creator_human_id) WHERE creator_human_id IS NOT NULL;

CREATE INDEX context_packs_creator_agent_idx  ON context_packs  (creator_agent_id) WHERE creator_agent_id IS NOT NULL;
CREATE INDEX context_packs_creator_human_idx  ON context_packs  (creator_human_id) WHERE creator_human_id IS NOT NULL;

CREATE INDEX rendered_packs_creator_agent_idx ON rendered_packs (creator_agent_id) WHERE creator_agent_id IS NOT NULL;
CREATE INDEX rendered_packs_creator_human_idx ON rendered_packs (creator_human_id) WHERE creator_human_id IS NOT NULL;

CREATE INDEX teams_creator_agent_idx          ON teams          (creator_agent_id) WHERE creator_agent_id IS NOT NULL;
CREATE INDEX teams_creator_human_idx          ON teams          (creator_human_id) WHERE creator_human_id IS NOT NULL;

CREATE INDEX groups_creator_agent_idx         ON groups         (creator_agent_id) WHERE creator_agent_id IS NOT NULL;
CREATE INDEX groups_creator_human_idx         ON groups         (creator_human_id) WHERE creator_human_id IS NOT NULL;

CREATE INDEX team_invites_creator_agent_idx   ON team_invites   (creator_agent_id) WHERE creator_agent_id IS NOT NULL;
CREATE INDEX team_invites_creator_human_idx   ON team_invites   (creator_human_id) WHERE creator_human_id IS NOT NULL;
