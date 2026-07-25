CREATE TYPE "public"."signing_credential_status" AS ENUM('pending_approval', 'active', 'suspended', 'revoked');--> statement-breakpoint
ALTER TYPE "public"."signing_request_status" ADD VALUE 'claimed' BEFORE 'completed';--> statement-breakpoint
ALTER TYPE "public"."signing_request_status" ADD VALUE 'rejected' BEFORE 'expired';--> statement-breakpoint
CREATE TABLE "signing_credential_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_human_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"verification_method" "verification_method" NOT NULL,
	"credential_type" varchar(100) NOT NULL,
	"algorithm" varchar(100) NOT NULL,
	"label" varchar(255) NOT NULL,
	"challenge" jsonb NOT NULL,
	"method_state" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signing_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_agent_id" uuid,
	"owner_human_id" uuid,
	"team_id" uuid NOT NULL,
	"verification_method" "verification_method" NOT NULL,
	"credential_type" varchar(100) NOT NULL,
	"algorithm" varchar(100) NOT NULL,
	"public_material" jsonb NOT NULL,
	"enrollment_evidence" jsonb NOT NULL,
	"label" varchar(255) NOT NULL,
	"status" "signing_credential_status" DEFAULT 'pending_approval' NOT NULL,
	"approved_by_human_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "signing_credentials_owner_xor" CHECK ((owner_agent_id IS NOT NULL) <> (owner_human_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "signing_credential_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credential_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"actor_agent_id" uuid,
	"actor_human_id" uuid,
	"from_status" "signing_credential_status" NOT NULL,
	"to_status" "signing_credential_status" NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signing_credential_events_actor_xor" CHECK ((actor_agent_id IS NOT NULL) <> (actor_human_id IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "signing_requests" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "signing_requests" ADD COLUMN "purpose" text;--> statement-breakpoint
ALTER TABLE "signing_requests" ADD COLUMN "claimed_by_human_id" uuid;--> statement-breakpoint
ALTER TABLE "signing_requests" ADD COLUMN "signing_credential_id" uuid;--> statement-breakpoint
ALTER TABLE "signing_requests" ADD COLUMN "challenge" jsonb;--> statement-breakpoint
ALTER TABLE "signing_requests" ADD COLUMN "method_state" jsonb;--> statement-breakpoint
ALTER TABLE "signing_requests" ADD COLUMN "receipt" jsonb;--> statement-breakpoint
ALTER TABLE "signing_requests" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "signing_requests" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "signing_requests" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "signing_credential_registrations" ADD CONSTRAINT "signing_credential_registrations_owner_human_id_humans_id_fk" FOREIGN KEY ("owner_human_id") REFERENCES "public"."humans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_credential_registrations" ADD CONSTRAINT "signing_credential_registrations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_credentials" ADD CONSTRAINT "signing_credentials_owner_agent_id_agents_identity_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("identity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_credentials" ADD CONSTRAINT "signing_credentials_owner_human_id_humans_id_fk" FOREIGN KEY ("owner_human_id") REFERENCES "public"."humans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_credentials" ADD CONSTRAINT "signing_credentials_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_credentials" ADD CONSTRAINT "signing_credentials_approved_by_human_id_humans_id_fk" FOREIGN KEY ("approved_by_human_id") REFERENCES "public"."humans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_credential_events" ADD CONSTRAINT "signing_credential_events_credential_id_signing_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."signing_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_credential_events" ADD CONSTRAINT "signing_credential_events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_credential_events" ADD CONSTRAINT "signing_credential_events_actor_agent_id_agents_identity_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents"("identity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_credential_events" ADD CONSTRAINT "signing_credential_events_actor_human_id_humans_id_fk" FOREIGN KEY ("actor_human_id") REFERENCES "public"."humans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signing_credential_registrations_owner_idx" ON "signing_credential_registrations" USING btree ("owner_human_id");--> statement-breakpoint
CREATE INDEX "signing_credential_registrations_expires_idx" ON "signing_credential_registrations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "signing_credentials_owner_agent_idx" ON "signing_credentials" USING btree ("owner_agent_id","status") WHERE owner_agent_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "signing_credentials_owner_human_idx" ON "signing_credentials" USING btree ("owner_human_id","status") WHERE owner_human_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "signing_credentials_team_idx" ON "signing_credentials" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "signing_credentials_method_idx" ON "signing_credentials" USING btree ("verification_method","status");--> statement-breakpoint
CREATE INDEX "signing_credential_events_credential_idx" ON "signing_credential_events" USING btree ("credential_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "signing_credential_events_team_idx" ON "signing_credential_events" USING btree ("team_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "signing_requests" ADD CONSTRAINT "signing_requests_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "signing_requests" ADD CONSTRAINT "signing_requests_claimed_by_human_id_humans_id_fk" FOREIGN KEY ("claimed_by_human_id") REFERENCES "public"."humans"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "signing_requests" ADD CONSTRAINT "signing_requests_signing_credential_id_signing_credentials_id_fk" FOREIGN KEY ("signing_credential_id") REFERENCES "public"."signing_credentials"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "signing_requests" VALIDATE CONSTRAINT "signing_requests_team_id_teams_id_fk";--> statement-breakpoint
ALTER TABLE "signing_requests" VALIDATE CONSTRAINT "signing_requests_claimed_by_human_id_humans_id_fk";--> statement-breakpoint
ALTER TABLE "signing_requests" VALIDATE CONSTRAINT "signing_requests_signing_credential_id_signing_credentials_id_fk";--> statement-breakpoint
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE INDEX "signing_requests_requested_by_idx" ON "signing_requests" USING gin ("requested_by");--> statement-breakpoint
CREATE INDEX "signing_requests_team_status_idx" ON "signing_requests" USING btree ("team_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "signing_requests_claimed_by_idx" ON "signing_requests" USING btree ("claimed_by_human_id","status");
