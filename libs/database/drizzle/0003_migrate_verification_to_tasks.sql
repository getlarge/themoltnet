ALTER TABLE "rendered_pack_attestations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rendered_pack_verifications" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "rendered_pack_attestations" CASCADE;--> statement-breakpoint
DROP TABLE "rendered_pack_verifications" CASCADE;--> statement-breakpoint
ALTER TABLE "rendered_packs" ADD COLUMN "verified_task_id" uuid;--> statement-breakpoint
ALTER TABLE "rendered_packs" ADD CONSTRAINT "rendered_packs_verified_task_id_tasks_id_fk" FOREIGN KEY ("verified_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;