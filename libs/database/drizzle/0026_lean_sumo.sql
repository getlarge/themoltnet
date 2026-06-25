CREATE TYPE "public"."runtime_session_checkpoint_kind" AS ENUM('attempt_final');--> statement-breakpoint
CREATE TYPE "public"."runtime_session_kind" AS ENUM('root', 'extend', 'fork');--> statement-breakpoint
CREATE TABLE "runtime_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"attempt_n" integer NOT NULL,
	"source_slot_id" uuid,
	"source_runtime_profile_id" uuid,
	"session_kind" "runtime_session_kind" NOT NULL,
	"parent_session_id" uuid,
	"object_key" text NOT NULL,
	"content_type" varchar(200) NOT NULL,
	"content_encoding" varchar(100),
	"size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"storage_class" varchar(100) NOT NULL,
	"checkpoint_kind" "runtime_session_checkpoint_kind" DEFAULT 'attempt_final' NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "runtime_sessions_size_bytes_non_negative" CHECK (size_bytes >= 0),
	CONSTRAINT "runtime_sessions_sha256_hex" CHECK (sha256 ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "runtime_sessions_parent_not_self" CHECK (parent_session_id IS NULL OR parent_session_id <> id)
);
--> statement-breakpoint
ALTER TABLE "runtime_sessions" ADD CONSTRAINT "runtime_sessions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_sessions" ADD CONSTRAINT "runtime_sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_sessions" ADD CONSTRAINT "runtime_sessions_source_slot_id_runtime_slots_id_fk" FOREIGN KEY ("source_slot_id") REFERENCES "public"."runtime_slots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_sessions" ADD CONSTRAINT "runtime_sessions_source_runtime_profile_id_runtime_profiles_id_fk" FOREIGN KEY ("source_runtime_profile_id") REFERENCES "public"."runtime_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_sessions" ADD CONSTRAINT "runtime_sessions_parent_session_id_runtime_sessions_id_fk" FOREIGN KEY ("parent_session_id") REFERENCES "public"."runtime_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_sessions" ADD CONSTRAINT "runtime_sessions_task_id_attempt_n_task_attempts_task_id_attempt_n_fk" FOREIGN KEY ("task_id","attempt_n") REFERENCES "public"."task_attempts"("task_id","attempt_n") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_sessions_active_attempt_idx" ON "runtime_sessions" USING btree ("team_id","task_id","attempt_n") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_sessions_object_key_idx" ON "runtime_sessions" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "runtime_sessions_team_idx" ON "runtime_sessions" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "runtime_sessions_task_attempt_idx" ON "runtime_sessions" USING btree ("team_id","task_id","attempt_n");--> statement-breakpoint
CREATE INDEX "runtime_sessions_parent_idx" ON "runtime_sessions" USING btree ("parent_session_id") WHERE parent_session_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "runtime_sessions_source_slot_idx" ON "runtime_sessions" USING btree ("source_slot_id") WHERE source_slot_id IS NOT NULL;