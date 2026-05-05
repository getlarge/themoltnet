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

-- 2. Backfill creator_{agent,human}_id from the legacy created_by column.
--
-- created_by holds a Kratos identity_id that resolves to either an `agents`
-- row (creator_agent_id := created_by) or a `humans` row (creator_human_id
-- := humans.id WHERE humans.identity_id = created_by). The original version
-- of this migration assumed every row was agent-created and aborted on any
-- non-agent row; that assumption was false in production (humans had been
-- creating resources via the REST API since the humans table was added,
-- see episodic entry f1fe4fe6-f9ef-4c9f-be1b-6a79c7816354).
--
-- New ordering:
--   2a. Resolve agents (set creator_agent_id where created_by is in agents).
--   2b. Resolve humans (set creator_human_id where created_by is in humans).
--   2c. Re-count rows where neither column is set — these are the only
--       genuine orphans. Abort with the per-table list if any exist.
--
-- NOT EXISTS (correlated subquery), not NOT IN (subquery): NOT IN against a
-- subquery that yields a NULL silently treats the WHERE as UNKNOWN and drops
-- every row, so the orphan count comes back 0 and the abort never fires.
-- NOT EXISTS is NULL-safe and cheaper.
UPDATE diaries        d SET creator_agent_id = d.created_by WHERE EXISTS (SELECT 1 FROM agents a WHERE a.identity_id = d.created_by);
UPDATE diary_entries  d SET creator_agent_id = d.created_by WHERE EXISTS (SELECT 1 FROM agents a WHERE a.identity_id = d.created_by);
UPDATE context_packs  d SET creator_agent_id = d.created_by WHERE EXISTS (SELECT 1 FROM agents a WHERE a.identity_id = d.created_by);
UPDATE rendered_packs d SET creator_agent_id = d.created_by WHERE EXISTS (SELECT 1 FROM agents a WHERE a.identity_id = d.created_by);
UPDATE teams          d SET creator_agent_id = d.created_by WHERE EXISTS (SELECT 1 FROM agents a WHERE a.identity_id = d.created_by);
UPDATE groups         d SET creator_agent_id = d.created_by WHERE EXISTS (SELECT 1 FROM agents a WHERE a.identity_id = d.created_by);
UPDATE team_invites   d SET creator_agent_id = d.created_by WHERE EXISTS (SELECT 1 FROM agents a WHERE a.identity_id = d.created_by);

UPDATE diaries        d SET creator_human_id = h.id FROM humans h WHERE h.identity_id = d.created_by AND d.creator_agent_id IS NULL;
UPDATE diary_entries  d SET creator_human_id = h.id FROM humans h WHERE h.identity_id = d.created_by AND d.creator_agent_id IS NULL;
UPDATE context_packs  d SET creator_human_id = h.id FROM humans h WHERE h.identity_id = d.created_by AND d.creator_agent_id IS NULL;
UPDATE rendered_packs d SET creator_human_id = h.id FROM humans h WHERE h.identity_id = d.created_by AND d.creator_agent_id IS NULL;
UPDATE teams          d SET creator_human_id = h.id FROM humans h WHERE h.identity_id = d.created_by AND d.creator_agent_id IS NULL;
UPDATE groups         d SET creator_human_id = h.id FROM humans h WHERE h.identity_id = d.created_by AND d.creator_agent_id IS NULL;
UPDATE team_invites   d SET creator_human_id = h.id FROM humans h WHERE h.identity_id = d.created_by AND d.creator_agent_id IS NULL;

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
  SELECT count(*) INTO orphan_diaries        FROM diaries        d WHERE d.creator_agent_id IS NULL AND d.creator_human_id IS NULL;
  SELECT count(*) INTO orphan_diary_entries  FROM diary_entries  d WHERE d.creator_agent_id IS NULL AND d.creator_human_id IS NULL;
  SELECT count(*) INTO orphan_context_packs  FROM context_packs  d WHERE d.creator_agent_id IS NULL AND d.creator_human_id IS NULL;
  SELECT count(*) INTO orphan_rendered_packs FROM rendered_packs d WHERE d.creator_agent_id IS NULL AND d.creator_human_id IS NULL;
  SELECT count(*) INTO orphan_teams          FROM teams          d WHERE d.creator_agent_id IS NULL AND d.creator_human_id IS NULL;
  SELECT count(*) INTO orphan_groups         FROM groups         d WHERE d.creator_agent_id IS NULL AND d.creator_human_id IS NULL;
  SELECT count(*) INTO orphan_team_invites   FROM team_invites   d WHERE d.creator_agent_id IS NULL AND d.creator_human_id IS NULL;

  IF orphan_diaries        > 0 THEN affected := array_append(affected, format('diaries (%s)',        orphan_diaries));        END IF;
  IF orphan_diary_entries  > 0 THEN affected := array_append(affected, format('diary_entries (%s)',  orphan_diary_entries));  END IF;
  IF orphan_context_packs  > 0 THEN affected := array_append(affected, format('context_packs (%s)',  orphan_context_packs));  END IF;
  IF orphan_rendered_packs > 0 THEN affected := array_append(affected, format('rendered_packs (%s)', orphan_rendered_packs)); END IF;
  IF orphan_teams          > 0 THEN affected := array_append(affected, format('teams (%s)',          orphan_teams));          END IF;
  IF orphan_groups         > 0 THEN affected := array_append(affected, format('groups (%s)',         orphan_groups));         END IF;
  IF orphan_team_invites   > 0 THEN affected := array_append(affected, format('team_invites (%s)',   orphan_team_invites));   END IF;

  IF array_length(affected, 1) > 0 THEN
    -- E'...' on the whole literal so the embedded \n sequences become real
    -- newlines. Mixing 'plain' and E'plain' across line continuations is a
    -- parse error at the first non-E continuation.
    RAISE EXCEPTION E'Migration aborted: rows have created_by values found in neither agents nor humans. Affected tables: %. These rows reference an identity_id that no longer exists. Inspect with:\n  SELECT id, created_by FROM <affected_table>\n    WHERE NOT EXISTS (SELECT 1 FROM agents a WHERE a.identity_id = <affected_table>.created_by)\n      AND NOT EXISTS (SELECT 1 FROM humans h WHERE h.identity_id = <affected_table>.created_by);\nThen either restore the missing principal or delete the orphan rows before re-running the migration.',
      array_to_string(affected, ', ');
  END IF;
END $$;

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
