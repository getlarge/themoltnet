SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "creator_agent_id" uuid,
  "creator_human_id" uuid,
  "name" varchar(255) NOT NULL,
  "description" text,
  "default_diary_id" uuid,
  "archived" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "projects_creator_xor" CHECK (("creator_agent_id" IS NOT NULL) <> ("creator_human_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_default_diary_id_diaries_id_fk" FOREIGN KEY ("default_diary_id") REFERENCES "public"."diaries"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_creator_agent_id_agents_id_fk" FOREIGN KEY ("creator_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_creator_human_id_humans_id_fk" FOREIGN KEY ("creator_human_id") REFERENCES "public"."humans"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "projects_team_name_idx" ON "projects" USING btree ("team_id",lower(btrim("name")));
--> statement-breakpoint
CREATE INDEX "projects_default_diary_idx" ON "projects" USING btree ("default_diary_id") WHERE "default_diary_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "project_id" uuid;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action NOT VALID;

-- runMigrations executes the following statements after Drizzle commits and
-- records this migration tag in drizzle.__moltnet_post_migrations. Drizzle
-- treats the marked block as a comment. Never run these scans in its transaction.
/* moltnet:post-commit
CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_project_created_idx ON public.tasks (project_id, created_at) WHERE project_id IS NOT NULL;
-- moltnet:statement-breakpoint
SET lock_timeout = '5s';
-- moltnet:statement-breakpoint
ALTER TABLE public.tasks VALIDATE CONSTRAINT tasks_project_id_projects_id_fk;
*/
