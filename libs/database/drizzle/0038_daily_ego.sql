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
CREATE INDEX "credential_evidence_events_jti_idx" ON "credential_evidence_events" USING btree ("credential_jti") WHERE credential_jti IS NOT NULL;--> statement-breakpoint
-- Everything below is hand-written: Drizzle cannot model triggers.
--
-- Credential evidence is an audit trail: rows may be appended and, once past
-- the retention window, deleted — but never rewritten. Enforce that in the
-- database so an application bug (or a hand-run UPDATE) cannot revise history.
-- DELETE stays permitted so the retention prune can age rows out by
-- occurred_at. See libs/database/src/schema/credential-evidence-events.ts.
CREATE OR REPLACE FUNCTION prevent_credential_evidence_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'credential_evidence_events is append-only. Emit a new evidence event instead of updating %.', OLD.id;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS credential_evidence_events_append_only ON "credential_evidence_events";
--> statement-breakpoint
CREATE TRIGGER credential_evidence_events_append_only
  BEFORE UPDATE ON "credential_evidence_events"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_credential_evidence_update();