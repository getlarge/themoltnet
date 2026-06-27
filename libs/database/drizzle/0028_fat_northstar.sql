CREATE TABLE "task_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"attempt_n" integer NOT NULL,
	"kind" varchar(100) NOT NULL,
	"title" varchar(255) NOT NULL,
	"object_key" text NOT NULL,
	"content_type" varchar(200) NOT NULL,
	"content_encoding" varchar(100),
	"size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"cid" varchar(100) NOT NULL,
	"created_by_agent_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_artifacts_size_bytes_non_negative" CHECK (size_bytes >= 0),
	CONSTRAINT "task_artifacts_sha256_hex" CHECK (sha256 ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "task_artifacts" ADD CONSTRAINT "task_artifacts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifacts" ADD CONSTRAINT "task_artifacts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifacts" ADD CONSTRAINT "task_artifacts_created_by_agent_id_agents_identity_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("identity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifacts" ADD CONSTRAINT "task_artifacts_task_id_attempt_n_task_attempts_task_id_attempt_n_fk" FOREIGN KEY ("task_id","attempt_n") REFERENCES "public"."task_attempts"("task_id","attempt_n") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_artifacts_attempt_cid_idx" ON "task_artifacts" USING btree ("team_id","task_id","attempt_n","cid");--> statement-breakpoint
CREATE INDEX "task_artifacts_team_cid_idx" ON "task_artifacts" USING btree ("team_id","cid");--> statement-breakpoint
CREATE INDEX "task_artifacts_object_key_idx" ON "task_artifacts" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "task_artifacts_task_attempt_idx" ON "task_artifacts" USING btree ("team_id","task_id","attempt_n");--> statement-breakpoint
CREATE INDEX "task_artifacts_expires_idx" ON "task_artifacts" USING btree ("expires_at") WHERE expires_at IS NOT NULL;