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
-- assign random IDs and orphan all 21 FK columns. The constraint names and the
-- resulting schema below match what drizzle expects; only the data handling and
-- the primary-key swap are done by hand.

ALTER TABLE "agent_enrollments" DROP CONSTRAINT "agent_enrollments_creator_agent_id_agents_identity_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_enrollments" DROP CONSTRAINT "agent_enrollments_resulting_agent_id_agents_identity_id_fk";
--> statement-breakpoint
ALTER TABLE "context_packs" DROP CONSTRAINT "context_packs_creator_agent_id_agents_identity_id_fk";
--> statement-breakpoint
ALTER TABLE "correlation_seals" DROP CONSTRAINT "correlation_seals_sealed_by_agent_id_agents_identity_id_fk";
--> statement-breakpoint
ALTER TABLE "diaries" DROP CONSTRAINT "diaries_creator_agent_id_agents_identity_id_fk";
--> statement-breakpoint
ALTER TABLE "diary_entries" DROP CONSTRAINT "diary_entries_creator_agent_id_agents_identity_id_fk";
--> statement-breakpoint
ALTER TABLE "executor_manifest_registrations" DROP CONSTRAINT "executor_manifest_registrations_agent_identity_id_agents_identity_id_fk";
--> statement-breakpoint
ALTER TABLE "groups" DROP CONSTRAINT "groups_creator_agent_id_agents_identity_id_fk";
--> statement-breakpoint
ALTER TABLE "rendered_packs" DROP CONSTRAINT "rendered_packs_creator_agent_id_agents_identity_id_fk";
--> statement-breakpoint
ALTER TABLE "runtime_models" DROP CONSTRAINT "runtime_models_created_by_agent_id_agents_identity_id_fk";
--> statement-breakpoint
ALTER TABLE "runtime_policies" DROP CONSTRAINT "runtime_policies_created_by_agent_id_agents_identity_id_fk";
--> statement-breakpoint
ALTER TABLE "runtime_profiles" DROP CONSTRAINT "runtime_profiles_created_by_agent_id_agents_identity_id_fk";
--> statement-breakpoint
ALTER TABLE "signing_credential_events" DROP CONSTRAINT "signing_credential_events_actor_agent_id_agents_identity_id_fk";
--> statement-breakpoint
ALTER TABLE "signing_credentials" DROP CONSTRAINT "signing_credentials_owner_agent_id_agents_identity_id_fk";
--> statement-breakpoint
ALTER TABLE "task_artifacts" DROP CONSTRAINT "task_artifacts_created_by_agent_id_agents_identity_id_fk";
--> statement-breakpoint
ALTER TABLE "task_attempts" DROP CONSTRAINT "task_attempts_claimed_by_agent_id_agents_identity_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_proposed_by_agent_id_agents_identity_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_claim_agent_id_agents_identity_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_cancelled_by_agent_id_agents_identity_id_fk";
--> statement-breakpoint
ALTER TABLE "team_invites" DROP CONSTRAINT "team_invites_creator_agent_id_agents_identity_id_fk";
--> statement-breakpoint
ALTER TABLE "teams" DROP CONSTRAINT "teams_creator_agent_id_agents_identity_id_fk";
--> statement-breakpoint
-- Add the internal ID unseeded, then copy the current primary key into it.
-- This is the step that keeps every existing reference valid.
ALTER TABLE "agents" ADD COLUMN "id" uuid;--> statement-breakpoint

UPDATE "agents" SET "id" = "identity_id";--> statement-breakpoint

ALTER TABLE "agents" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint

-- Drop the old primary key by its real name. drizzle-kit could not resolve this
-- and left it commented out; resolving it dynamically also survives a database
-- whose constraint was not named by the Postgres default.
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

-- New agents get a generated ID; existing rows keep their seeded value.
ALTER TABLE "agents" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint

-- identity_id becomes optional: NULL means "no live Kratos identity", and the
-- agent keeps its data, ownership and permissions regardless.
ALTER TABLE "agents" ALTER COLUMN "identity_id" DROP NOT NULL;--> statement-breakpoint

ALTER TABLE "agents" ADD CONSTRAINT "agents_identity_id_unique" UNIQUE("identity_id");
--> statement-breakpoint
ALTER TABLE "agent_enrollments" ADD CONSTRAINT "agent_enrollments_creator_agent_id_agents_id_fk" FOREIGN KEY ("creator_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_enrollments" ADD CONSTRAINT "agent_enrollments_resulting_agent_id_agents_id_fk" FOREIGN KEY ("resulting_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "context_packs" ADD CONSTRAINT "context_packs_creator_agent_id_agents_id_fk" FOREIGN KEY ("creator_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "correlation_seals" ADD CONSTRAINT "correlation_seals_sealed_by_agent_id_agents_id_fk" FOREIGN KEY ("sealed_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "diaries" ADD CONSTRAINT "diaries_creator_agent_id_agents_id_fk" FOREIGN KEY ("creator_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_creator_agent_id_agents_id_fk" FOREIGN KEY ("creator_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "executor_manifest_registrations" ADD CONSTRAINT "executor_manifest_registrations_agent_identity_id_agents_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_creator_agent_id_agents_id_fk" FOREIGN KEY ("creator_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rendered_packs" ADD CONSTRAINT "rendered_packs_creator_agent_id_agents_id_fk" FOREIGN KEY ("creator_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "runtime_models" ADD CONSTRAINT "runtime_models_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "runtime_policies" ADD CONSTRAINT "runtime_policies_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "runtime_profiles" ADD CONSTRAINT "runtime_profiles_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "signing_credential_events" ADD CONSTRAINT "signing_credential_events_actor_agent_id_agents_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "signing_credentials" ADD CONSTRAINT "signing_credentials_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_artifacts" ADD CONSTRAINT "task_artifacts_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_claimed_by_agent_id_agents_id_fk" FOREIGN KEY ("claimed_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_proposed_by_agent_id_agents_id_fk" FOREIGN KEY ("proposed_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_claim_agent_id_agents_id_fk" FOREIGN KEY ("claim_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_cancelled_by_agent_id_agents_id_fk" FOREIGN KEY ("cancelled_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_creator_agent_id_agents_id_fk" FOREIGN KEY ("creator_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_creator_agent_id_agents_id_fk" FOREIGN KEY ("creator_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- Post-conditions: fail loudly rather than leave a half-migrated graph.
DO $$
DECLARE mismatched bigint; retargeted bigint; orphaned bigint;
BEGIN
  SELECT count(*) INTO mismatched FROM "agents" WHERE "id" IS DISTINCT FROM "identity_id";
  IF mismatched > 0 THEN
    RAISE EXCEPTION 'agents.id was not seeded from identity_id for % row(s)', mismatched;
  END IF;

  SELECT count(*) INTO retargeted
  FROM information_schema.constraint_column_usage ccu
  JOIN information_schema.table_constraints tc
    ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
  WHERE ccu.table_name = 'agents' AND ccu.column_name = 'id'
    AND tc.constraint_type = 'FOREIGN KEY';
  IF retargeted <> 21 THEN
    RAISE EXCEPTION 'Expected 21 foreign keys on agents(id), found %', retargeted;
  END IF;

  SELECT count(*) INTO orphaned FROM "teams" t
  LEFT JOIN "agents" a ON a."id" = t."creator_agent_id"
  WHERE t."creator_agent_id" IS NOT NULL AND a."id" IS NULL;
  IF orphaned > 0 THEN
    RAISE EXCEPTION '% team(s) reference a non-existent agent after migration', orphaned;
  END IF;

  RAISE NOTICE 'Decoupling complete: 21 foreign keys now target agents(id)';
END $$;
