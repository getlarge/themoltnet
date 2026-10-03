CREATE TABLE "runtime_store_attempts" (
	"team_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"attempt_n" integer NOT NULL,
	"store_id" uuid NOT NULL,
	CONSTRAINT "runtime_store_attempts_task_id_attempt_n_pk" PRIMARY KEY("task_id","attempt_n")
);
--> statement-breakpoint
CREATE TABLE "runtime_store_commits" (
	"store_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"commit_id" uuid NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"object_key" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"task_id" uuid NOT NULL,
	"attempt_n" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_store_commits_store_id_seq_pk" PRIMARY KEY("store_id","seq"),
	CONSTRAINT "runtime_store_commits_valid" CHECK ("runtime_store_commits"."seq" > 0 AND "runtime_store_commits"."size_bytes" >= 0 AND "runtime_store_commits"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "runtime_stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"format" text DEFAULT 'pi-durable.v1' NOT NULL,
	"head_seq" integer DEFAULT 0 NOT NULL,
	"next_id" bigint DEFAULT 2 NOT NULL,
	"writer_token" uuid,
	"writer_agent_id" uuid,
	"writer_task_id" uuid,
	"writer_attempt_n" integer,
	"writer_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_stores_sequence_positive" CHECK ("runtime_stores"."head_seq" >= 0 AND "runtime_stores"."next_id" > 0 AND "runtime_stores"."next_id" <= 9007199254740991)
);
--> statement-breakpoint
ALTER TABLE "runtime_store_attempts" ADD CONSTRAINT "runtime_store_attempts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_store_attempts" ADD CONSTRAINT "runtime_store_attempts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_store_attempts" ADD CONSTRAINT "runtime_store_attempts_store_id_runtime_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."runtime_stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_store_attempts" ADD CONSTRAINT "runtime_store_attempts_task_id_attempt_n_task_attempts_task_id_attempt_n_fk" FOREIGN KEY ("task_id","attempt_n") REFERENCES "public"."task_attempts"("task_id","attempt_n") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_store_commits" ADD CONSTRAINT "runtime_store_commits_store_id_runtime_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."runtime_stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_stores" ADD CONSTRAINT "runtime_stores_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runtime_store_attempts_store_idx" ON "runtime_store_attempts" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_store_commits_request_idx" ON "runtime_store_commits" USING btree ("store_id","commit_id");--> statement-breakpoint
CREATE INDEX "runtime_stores_team_idx" ON "runtime_stores" USING btree ("team_id");