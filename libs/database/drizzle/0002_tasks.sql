CREATE TYPE "public"."output_kind" AS ENUM('artifact', 'judgment');--> statement-breakpoint
CREATE TYPE "public"."task_attempt_status" AS ENUM('claimed', 'running', 'completed', 'failed', 'cancelled', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."task_message_kind" AS ENUM('text_delta', 'tool_call_start', 'tool_call_end', 'turn_end', 'error', 'info');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('queued', 'dispatched', 'running', 'completed', 'failed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "task_attempts" (
	"task_id" uuid NOT NULL,
	"attempt_n" integer NOT NULL,
	"claimed_by_agent_id" uuid NOT NULL,
	"runtime_id" uuid,
	"workflow_id" varchar(200) NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"status" "task_attempt_status" DEFAULT 'claimed' NOT NULL,
	"output" jsonb,
	"output_cid" varchar(100),
	"error" jsonb,
	"usage" jsonb,
	"content_signature" text,
	"signed_at" timestamp with time zone,
	CONSTRAINT "task_attempts_task_id_attempt_n_pk" PRIMARY KEY("task_id","attempt_n")
);
--> statement-breakpoint
CREATE TABLE "task_messages" (
	"task_id" uuid NOT NULL,
	"attempt_n" integer NOT NULL,
	"seq" bigint NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"kind" "task_message_kind" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "task_messages_task_id_attempt_n_seq_pk" PRIMARY KEY("task_id","attempt_n","seq")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_type" varchar(100) NOT NULL,
	"team_id" uuid NOT NULL,
	"diary_id" uuid,
	"output_kind" "output_kind" NOT NULL,
	"input" jsonb NOT NULL,
	"input_schema_cid" varchar(100) NOT NULL,
	"input_cid" varchar(100) NOT NULL,
	"criteria_cid" varchar(100),
	"task_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"correlation_id" uuid,
	"imposed_by_agent_id" uuid,
	"imposed_by_human_id" uuid,
	"accepted_attempt_n" integer,
	"claim_agent_id" uuid,
	"claim_expires_at" timestamp with time zone,
	"status" "task_status" DEFAULT 'queued' NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"cancelled_by_agent_id" uuid,
	"cancelled_by_human_id" uuid,
	"cancel_reason" text,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_imposer_xor" CHECK ((imposed_by_agent_id IS NOT NULL) <> (imposed_by_human_id IS NOT NULL)),
	CONSTRAINT "tasks_canceller_xor" CHECK (status <> 'cancelled' OR (cancelled_by_agent_id IS NOT NULL) <> (cancelled_by_human_id IS NOT NULL)),
	CONSTRAINT "tasks_cancel_reason_required" CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_claimed_by_agent_id_agents_identity_id_fk" FOREIGN KEY ("claimed_by_agent_id") REFERENCES "public"."agents"("identity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_messages" ADD CONSTRAINT "task_messages_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_diary_id_diaries_id_fk" FOREIGN KEY ("diary_id") REFERENCES "public"."diaries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_imposed_by_agent_id_agents_identity_id_fk" FOREIGN KEY ("imposed_by_agent_id") REFERENCES "public"."agents"("identity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_imposed_by_human_id_humans_id_fk" FOREIGN KEY ("imposed_by_human_id") REFERENCES "public"."humans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_claim_agent_id_agents_identity_id_fk" FOREIGN KEY ("claim_agent_id") REFERENCES "public"."agents"("identity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_cancelled_by_agent_id_agents_identity_id_fk" FOREIGN KEY ("cancelled_by_agent_id") REFERENCES "public"."agents"("identity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_cancelled_by_human_id_humans_id_fk" FOREIGN KEY ("cancelled_by_human_id") REFERENCES "public"."humans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_attempts_task_idx" ON "task_attempts" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_attempts_workflow_idx" ON "task_attempts" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "task_messages_task_attempt_idx" ON "task_messages" USING btree ("task_id","attempt_n");--> statement-breakpoint
CREATE INDEX "tasks_team_status_idx" ON "tasks" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "tasks_type_status_idx" ON "tasks" USING btree ("task_type","status");--> statement-breakpoint
CREATE INDEX "tasks_correlation_idx" ON "tasks" USING btree ("correlation_id") WHERE correlation_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "tasks_claim_expires_idx" ON "tasks" USING btree ("claim_expires_at") WHERE claim_expires_at IS NOT NULL;
--> statement-breakpoint
-- Composite FK: task_messages(task_id, attempt_n) → task_attempts(task_id, attempt_n)
-- Drizzle's FK API does not support composite foreign keys, so this is added manually.
ALTER TABLE "task_messages"
  ADD CONSTRAINT "task_messages_attempt_fk"
    FOREIGN KEY ("task_id", "attempt_n")
    REFERENCES "task_attempts" ("task_id", "attempt_n")
    ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "tasks_diary_idx" ON "tasks" USING btree ("diary_id") WHERE diary_id IS NOT NULL;
