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

DROP TABLE "_fk_backup";
