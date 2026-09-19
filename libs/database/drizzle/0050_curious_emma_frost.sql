ALTER TABLE "projects" ADD COLUMN "creator_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "creator_human_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_creator_agent_id_agents_id_fk" FOREIGN KEY ("creator_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_creator_human_id_humans_id_fk" FOREIGN KEY ("creator_human_id") REFERENCES "public"."humans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_default_diary_idx" ON "projects" USING btree ("default_diary_id") WHERE "projects"."default_diary_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_creator_xor" CHECK (("projects"."creator_agent_id" IS NOT NULL) <> ("projects"."creator_human_id" IS NOT NULL));
-- tasks_project_created_idx is built concurrently by runMigrations after the schema transaction commits.
