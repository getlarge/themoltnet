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
DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT count(*) INTO orphan_count FROM (
    SELECT created_by FROM diaries
      WHERE created_by NOT IN (SELECT identity_id FROM agents)
    UNION ALL
    SELECT created_by FROM diary_entries
      WHERE created_by NOT IN (SELECT identity_id FROM agents)
    UNION ALL
    SELECT created_by FROM context_packs
      WHERE created_by NOT IN (SELECT identity_id FROM agents)
    UNION ALL
    SELECT created_by FROM rendered_packs
      WHERE created_by NOT IN (SELECT identity_id FROM agents)
    UNION ALL
    SELECT created_by FROM teams
      WHERE created_by NOT IN (SELECT identity_id FROM agents)
    UNION ALL
    SELECT created_by FROM groups
      WHERE created_by NOT IN (SELECT identity_id FROM agents)
    UNION ALL
    SELECT created_by FROM team_invites
      WHERE created_by NOT IN (SELECT identity_id FROM agents)
  ) orphans;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'Migration aborted: % rows have created_by not matching any agent. '
      'Manual backfill required for human-created rows. '
      'Inspect each table with: '
      'SELECT created_by FROM <table> WHERE created_by NOT IN (SELECT identity_id FROM agents);',
      orphan_count;
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
