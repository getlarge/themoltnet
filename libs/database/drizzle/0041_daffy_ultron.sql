-- Decouple agents from Ory Kratos identity IDs.
--
-- `agents.identity_id` was the primary key, so a Kratos identity ID was at once
-- MoltNet's internal agent ID, the target of 21 foreign keys, the Keto subject
-- (`Agent:<uuid>`) and the join key in Hydra client metadata. Deleting
-- identities upstream therefore orphaned the whole graph (incident 2026-09-04).
--
-- `agents.id` is SEEDED from the current `identity_id`, so every FK value and
-- every `Agent:` Keto tuple stays valid with NO data rewrite. Afterwards
-- `identity_id` is a nullable unique column binding an agent to Ory, and losing
-- Kratos again costs one UPDATE per agent instead of rebuilding the graph.
--
-- NOTE: drizzle-kit generated a destructive version of this migration
-- (`ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()`), which would
-- assign random IDs and orphan all 21 FK columns.
--
-- It also emitted DROP CONSTRAINT statements using its own naming convention,
-- which does not match reality: production carries a mix of drizzle-style
-- names (`..._agents_identity_id_fk`), Postgres defaults (`..._fkey`) and at
-- least one truncated at the 63-character identifier limit. A rehearsal
-- against a restored copy failed on the first `_fkey` constraint. Constraints
-- are therefore DROPPED by their discovered name and RECREATED under drizzle's
-- canonical `<table>_<column>_agents_id_fk`, so the migration works against any
-- existing naming while leaving a schema that matches the drizzle snapshot.

ALTER TABLE "agents" ADD COLUMN "id" uuid;--> statement-breakpoint

-- Seed from the existing primary key: this is what keeps all 21 FK columns and
-- every Keto Agent: tuple valid without touching them.
UPDATE "agents" SET "id" = "identity_id";--> statement-breakpoint

ALTER TABLE "agents" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint

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
  RAISE NOTICE 'Retargeting % foreign keys to agents(id)', n;
END $$;--> statement-breakpoint

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM "_fk_backup" LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.table_name, r.constraint_name);
  END LOOP;
END $$;--> statement-breakpoint

-- Drop the old primary key by its real name; drizzle-kit could not resolve it.
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

ALTER TABLE "agents" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint

-- identity_id becomes optional: NULL means "no live Kratos identity", and the
-- agent keeps its data, ownership and permissions regardless.
ALTER TABLE "agents" ALTER COLUMN "identity_id" DROP NOT NULL;--> statement-breakpoint

ALTER TABLE "agents" ADD CONSTRAINT "agents_identity_id_unique" UNIQUE("identity_id");--> statement-breakpoint

-- Recreate under drizzle's canonical name, preserving the original delete rule
-- and deliberately WITHOUT ON UPDATE CASCADE. The 2026-09-04 relink added
-- cascade so one UPDATE could move an identity across all 21 child columns;
-- agents.id is immutable by design, so cascade would now be inert at best and
-- would silently rewrite 21 tables on a stray UPDATE at worst.
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
DECLARE mismatched bigint; retargeted bigint; expected bigint; leftover bigint;
BEGIN
  SELECT count(*) INTO expected FROM "_fk_backup";

  SELECT count(*) INTO mismatched FROM "agents" WHERE "id" IS DISTINCT FROM "identity_id";
  IF mismatched > 0 THEN
    RAISE EXCEPTION 'agents.id was not seeded from identity_id for % row(s)', mismatched;
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

  RAISE NOTICE 'Decoupling complete: % foreign keys now target agents(id)', retargeted;
END $$;--> statement-breakpoint

DROP TABLE "_fk_backup";
