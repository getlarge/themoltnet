CREATE TYPE "public"."signing_request_status" AS ENUM('pending', 'completed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('private', 'moltnet', 'public');--> statement-breakpoint
CREATE TABLE "agent_keys" (
	"identity_id" uuid PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"fingerprint" varchar(19) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(64) NOT NULL,
	"issuer_id" uuid NOT NULL,
	"redeemed_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diary_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" varchar(255),
	"content" text NOT NULL,
	"embedding" vector(384),
	"visibility" "visibility" DEFAULT 'private' NOT NULL,
	"tags" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entry_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"shared_by" uuid NOT NULL,
	"shared_with" uuid NOT NULL,
	"shared_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signing_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"message" text NOT NULL,
	"nonce" uuid DEFAULT gen_random_uuid() NOT NULL,
	"status" "signing_request_status" DEFAULT 'pending' NOT NULL,
	"signature" text,
	"valid" boolean,
	"workflow_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "entry_shares" ADD CONSTRAINT "entry_shares_entry_id_diary_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."diary_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_keys_fingerprint_idx" ON "agent_keys" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_vouchers_code_idx" ON "agent_vouchers" USING btree ("code");--> statement-breakpoint
CREATE INDEX "agent_vouchers_issuer_idx" ON "agent_vouchers" USING btree ("issuer_id");--> statement-breakpoint
CREATE INDEX "diary_entries_owner_idx" ON "diary_entries" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "diary_entries_visibility_idx" ON "diary_entries" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "diary_entries_owner_created_idx" ON "diary_entries" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "entry_shares_unique_idx" ON "entry_shares" USING btree ("entry_id","shared_with");--> statement-breakpoint
CREATE INDEX "entry_shares_shared_with_idx" ON "entry_shares" USING btree ("shared_with");--> statement-breakpoint
CREATE INDEX "entry_shares_shared_by_idx" ON "entry_shares" USING btree ("shared_by");--> statement-breakpoint
CREATE INDEX "signing_requests_agent_status_idx" ON "signing_requests" USING btree ("agent_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "signing_requests_workflow_idx" ON "signing_requests" USING btree ("workflow_id");