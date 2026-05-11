CREATE TABLE "correlation_seals" (
	"correlation_id" uuid PRIMARY KEY NOT NULL,
	"sealed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sealed_by_task_id" uuid NOT NULL,
	"sealed_by_task_type" varchar(100) NOT NULL,
	"sealed_by_agent_id" uuid,
	"sealed_by_human_id" uuid,
	CONSTRAINT "correlation_seals_caller_xor" CHECK ((sealed_by_agent_id IS NOT NULL) <> (sealed_by_human_id IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "correlation_seals" ADD CONSTRAINT "correlation_seals_sealed_by_task_id_tasks_id_fk" FOREIGN KEY ("sealed_by_task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correlation_seals" ADD CONSTRAINT "correlation_seals_sealed_by_agent_id_agents_identity_id_fk" FOREIGN KEY ("sealed_by_agent_id") REFERENCES "public"."agents"("identity_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correlation_seals" ADD CONSTRAINT "correlation_seals_sealed_by_human_id_humans_id_fk" FOREIGN KEY ("sealed_by_human_id") REFERENCES "public"."humans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "correlation_seals_sealed_by_task_idx" ON "correlation_seals" USING btree ("sealed_by_task_id");