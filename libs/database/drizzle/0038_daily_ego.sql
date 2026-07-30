CREATE TABLE "credential_evidence_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" smallint NOT NULL,
	"event" varchar(64) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"outcome" varchar(8) NOT NULL,
	"reason" varchar(255) NOT NULL,
	"agent_id" uuid,
	"team_id" uuid,
	"task_id" uuid,
	"attempt_n" integer,
	"connector_id" varchar(255),
	"operation" varchar(255),
	"resource_id" varchar(255),
	"grant_id" uuid,
	"grant_revision" integer,
	"credential_jti" varchar(255),
	"credential_kid" varchar(255),
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credential_evidence_events_outcome" CHECK ("credential_evidence_events"."outcome" IN ('allow', 'deny'))
);
--> statement-breakpoint
CREATE INDEX "credential_evidence_events_attempt_idx" ON "credential_evidence_events" USING btree ("task_id","attempt_n");--> statement-breakpoint
CREATE INDEX "credential_evidence_events_occurred_at_idx" ON "credential_evidence_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "credential_evidence_events_jti_idx" ON "credential_evidence_events" USING btree ("credential_jti") WHERE credential_jti IS NOT NULL;