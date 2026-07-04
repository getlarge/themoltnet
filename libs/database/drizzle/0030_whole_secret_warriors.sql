CREATE TABLE "task_attempt_activity_stats" (
	"task_id" uuid NOT NULL,
	"attempt_n" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_last_seq" bigint DEFAULT -1 NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"turn_count" integer DEFAULT 0 NOT NULL,
	"tool_call_count" integer DEFAULT 0 NOT NULL,
	"failed_tool_call_count" integer DEFAULT 0 NOT NULL,
	"knowledge_tool_call_count" integer DEFAULT 0 NOT NULL,
	"entry_search_count" integer DEFAULT 0 NOT NULL,
	"entry_get_count" integer DEFAULT 0 NOT NULL,
	"pack_get_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "task_attempt_activity_stats_task_id_attempt_n_pk" PRIMARY KEY("task_id","attempt_n")
);
--> statement-breakpoint
ALTER TABLE "task_attempt_activity_stats" ADD CONSTRAINT "task_attempt_activity_stats_task_id_attempt_n_task_attempts_task_id_attempt_n_fk" FOREIGN KEY ("task_id","attempt_n") REFERENCES "public"."task_attempts"("task_id","attempt_n") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_attempt_activity_stats_task_idx" ON "task_attempt_activity_stats" USING btree ("task_id");