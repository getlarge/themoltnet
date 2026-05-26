ALTER TYPE "public"."task_status" ADD VALUE 'waiting' BEFORE 'queued';--> statement-breakpoint
ALTER TABLE "tasks" RENAME COLUMN "imposed_by_agent_id" TO "proposed_by_agent_id";--> statement-breakpoint
ALTER TABLE "tasks" RENAME COLUMN "imposed_by_human_id" TO "proposed_by_human_id";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_imposer_xor";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_imposed_by_agent_id_agents_identity_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_imposed_by_human_id_humans_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "claim_condition" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_proposed_by_agent_id_agents_identity_id_fk" FOREIGN KEY ("proposed_by_agent_id") REFERENCES "public"."agents"("identity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_proposed_by_human_id_humans_id_fk" FOREIGN KEY ("proposed_by_human_id") REFERENCES "public"."humans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_proposer_xor" CHECK ((proposed_by_agent_id IS NOT NULL) <> (proposed_by_human_id IS NOT NULL));