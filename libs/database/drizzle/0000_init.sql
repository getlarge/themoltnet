CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."compression_level" AS ENUM('full', 'summary', 'keywords');--> statement-breakpoint
CREATE TYPE "public"."diary_transfer_status" AS ENUM('pending', 'accepted', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."entry_type" AS ENUM('episodic', 'semantic', 'procedural', 'reflection', 'identity', 'soul');--> statement-breakpoint
CREATE TYPE "public"."founding_acceptance_status" AS ENUM('pending', 'accepted');--> statement-breakpoint
CREATE TYPE "public"."pack_type" AS ENUM('compile', 'optimized', 'custom');--> statement-breakpoint
CREATE TYPE "public"."relation_status" AS ENUM('proposed', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."relation_type" AS ENUM('supersedes', 'elaborates', 'contradicts', 'supports', 'caused_by', 'references');--> statement-breakpoint
CREATE TYPE "public"."signing_request_status" AS ENUM('pending', 'completed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."team_invite_role" AS ENUM('manager', 'member');--> statement-breakpoint
CREATE TYPE "public"."team_status" AS ENUM('founding', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('private', 'moltnet', 'public');--> statement-breakpoint
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
CREATE TABLE "agents" (
	"identity_id" uuid PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"fingerprint" varchar(19) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_pack_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"entry_cid_snapshot" varchar(100) NOT NULL,
	"compression_level" "compression_level" DEFAULT 'full' NOT NULL,
	"original_tokens" integer,
	"packed_tokens" integer,
	"rank" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"diary_id" uuid NOT NULL,
	"pack_cid" varchar(100) NOT NULL,
	"pack_codec" varchar(50) DEFAULT 'dag-cbor' NOT NULL,
	"pack_type" "pack_type" DEFAULT 'compile' NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"supersedes_pack_id" uuid,
	"pinned" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone DEFAULT (now() + interval '7 days'),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"visibility" "visibility" DEFAULT 'private' NOT NULL,
	"signed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diary_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"diary_id" uuid NOT NULL,
	"title" varchar(255),
	"content" text NOT NULL,
	"embedding" vector(384),
	"tags" text[],
	"created_by" uuid NOT NULL,
	"injection_risk" boolean DEFAULT false NOT NULL,
	"importance" smallint DEFAULT 5 NOT NULL,
	"access_count" integer DEFAULT 0 NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"entry_type" "entry_type" DEFAULT 'semantic' NOT NULL,
	"content_hash" varchar(100),
	"content_signature" text,
	"signing_nonce" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diary_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"diary_id" uuid NOT NULL,
	"source_team_id" uuid NOT NULL,
	"destination_team_id" uuid NOT NULL,
	"workflow_id" text NOT NULL,
	"status" "diary_transfer_status" DEFAULT 'pending' NOT NULL,
	"initiated_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entry_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"relation" "relation_type" NOT NULL,
	"status" "relation_status" DEFAULT 'proposed' NOT NULL,
	"source_cid_snapshot" varchar(100),
	"target_cid_snapshot" varchar(100),
	"workflow_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "founding_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"subject_ns" varchar(20) NOT NULL,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"status" "founding_acceptance_status" DEFAULT 'pending' NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"team_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "humans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "humans_identity_id_unique" UNIQUE("identity_id")
);
--> statement-breakpoint
CREATE TABLE "rendered_pack_attestations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rendered_pack_id" uuid NOT NULL,
	"coverage" real NOT NULL,
	"grounding" real NOT NULL,
	"faithfulness" real NOT NULL,
	"composite" real NOT NULL,
	"judge_model" varchar(100) NOT NULL,
	"judge_provider" varchar(50) NOT NULL,
	"judge_binary_cid" varchar(100) NOT NULL,
	"rubric_cid" varchar(100),
	"created_by" uuid NOT NULL,
	"transcript" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rendered_pack_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rendered_pack_id" uuid NOT NULL,
	"nonce" uuid NOT NULL,
	"status" varchar(20) NOT NULL,
	"claimed_by" uuid,
	"claimed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rendered_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_cid" varchar(100) NOT NULL,
	"source_pack_id" uuid NOT NULL,
	"diary_id" uuid NOT NULL,
	"content" text NOT NULL,
	"content_hash" varchar(100) NOT NULL,
	"render_method" varchar(100) NOT NULL,
	"total_tokens" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone DEFAULT (now() + interval '7 days'),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "team_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"role" "team_invite_role" DEFAULT 'member' NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" "team_status" DEFAULT 'active' NOT NULL,
	"personal" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "used_recovery_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "context_pack_entries" ADD CONSTRAINT "context_pack_entries_pack_id_context_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."context_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_pack_entries" ADD CONSTRAINT "context_pack_entries_entry_id_diary_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."diary_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_packs" ADD CONSTRAINT "context_packs_diary_id_diaries_id_fk" FOREIGN KEY ("diary_id") REFERENCES "public"."diaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_packs" ADD CONSTRAINT "context_packs_supersedes_pack_id_context_packs_id_fk" FOREIGN KEY ("supersedes_pack_id") REFERENCES "public"."context_packs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diaries" ADD CONSTRAINT "diaries_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_diary_id_diaries_id_fk" FOREIGN KEY ("diary_id") REFERENCES "public"."diaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_transfers" ADD CONSTRAINT "diary_transfers_diary_id_diaries_id_fk" FOREIGN KEY ("diary_id") REFERENCES "public"."diaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_transfers" ADD CONSTRAINT "diary_transfers_source_team_id_teams_id_fk" FOREIGN KEY ("source_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_transfers" ADD CONSTRAINT "diary_transfers_destination_team_id_teams_id_fk" FOREIGN KEY ("destination_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_relations" ADD CONSTRAINT "entry_relations_source_id_diary_entries_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."diary_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_relations" ADD CONSTRAINT "entry_relations_target_id_diary_entries_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."diary_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founding_acceptances" ADD CONSTRAINT "founding_acceptances_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rendered_pack_attestations" ADD CONSTRAINT "rendered_pack_attestations_rendered_pack_id_rendered_packs_id_fk" FOREIGN KEY ("rendered_pack_id") REFERENCES "public"."rendered_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rendered_pack_verifications" ADD CONSTRAINT "rendered_pack_verifications_rendered_pack_id_rendered_packs_id_fk" FOREIGN KEY ("rendered_pack_id") REFERENCES "public"."rendered_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rendered_packs" ADD CONSTRAINT "rendered_packs_source_pack_id_context_packs_id_fk" FOREIGN KEY ("source_pack_id") REFERENCES "public"."context_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rendered_packs" ADD CONSTRAINT "rendered_packs_diary_id_diaries_id_fk" FOREIGN KEY ("diary_id") REFERENCES "public"."diaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_vouchers_code_idx" ON "agent_vouchers" USING btree ("code");--> statement-breakpoint
CREATE INDEX "agent_vouchers_issuer_idx" ON "agent_vouchers" USING btree ("issuer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_fingerprint_idx" ON "agents" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "context_pack_entries_unique_idx" ON "context_pack_entries" USING btree ("pack_id","entry_id");--> statement-breakpoint
CREATE INDEX "context_pack_entries_pack_idx" ON "context_pack_entries" USING btree ("pack_id");--> statement-breakpoint
CREATE INDEX "context_pack_entries_entry_idx" ON "context_pack_entries" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "context_packs_pack_cid_unique_idx" ON "context_packs" USING btree ("pack_cid");--> statement-breakpoint
CREATE INDEX "context_packs_diary_idx" ON "context_packs" USING btree ("diary_id");--> statement-breakpoint
CREATE INDEX "context_packs_pack_type_idx" ON "context_packs" USING btree ("pack_type");--> statement-breakpoint
CREATE INDEX "context_packs_expires_at_idx" ON "context_packs" USING btree ("expires_at") WHERE pinned = false;--> statement-breakpoint
CREATE INDEX "context_packs_pinned_idx" ON "context_packs" USING btree ("pinned");--> statement-breakpoint
CREATE INDEX "diaries_created_by_idx" ON "diaries" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "diaries_created_by_visibility_idx" ON "diaries" USING btree ("created_by","visibility");--> statement-breakpoint
CREATE INDEX "diaries_team_idx" ON "diaries" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "diary_entries_diary_idx" ON "diary_entries" USING btree ("diary_id");--> statement-breakpoint
CREATE INDEX "diary_entries_created_by_idx" ON "diary_entries" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "diary_entries_entry_type_idx" ON "diary_entries" USING btree ("entry_type");--> statement-breakpoint
CREATE UNIQUE INDEX "diary_entries_content_signature_unique_idx" ON "diary_entries" USING btree ("content_signature") WHERE content_signature IS NOT NULL;--> statement-breakpoint
CREATE INDEX "diary_entries_content_hash_idx" ON "diary_entries" USING btree ("content_hash") WHERE content_hash IS NOT NULL;--> statement-breakpoint
CREATE INDEX "diary_transfers_diary_idx" ON "diary_transfers" USING btree ("diary_id");--> statement-breakpoint
CREATE INDEX "diary_transfers_source_team_idx" ON "diary_transfers" USING btree ("source_team_id");--> statement-breakpoint
CREATE INDEX "diary_transfers_dest_team_idx" ON "diary_transfers" USING btree ("destination_team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "diary_transfers_workflow_idx" ON "diary_transfers" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entry_relations_unique_idx" ON "entry_relations" USING btree ("source_id","target_id","relation");--> statement-breakpoint
CREATE INDEX "entry_relations_source_idx" ON "entry_relations" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "entry_relations_target_idx" ON "entry_relations" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "entry_relations_type_idx" ON "entry_relations" USING btree ("relation");--> statement-breakpoint
CREATE INDEX "entry_relations_status_idx" ON "entry_relations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "founding_acceptances_team_idx" ON "founding_acceptances" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "founding_acceptances_team_subject_idx" ON "founding_acceptances" USING btree ("team_id","subject_id");--> statement-breakpoint
CREATE INDEX "groups_team_idx" ON "groups" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_name_team_idx" ON "groups" USING btree ("name","team_id");--> statement-breakpoint
CREATE INDEX "attestations_rendered_pack_idx" ON "rendered_pack_attestations" USING btree ("rendered_pack_id");--> statement-breakpoint
CREATE INDEX "attestations_composite_idx" ON "rendered_pack_attestations" USING btree ("composite");--> statement-breakpoint
CREATE INDEX "verifications_rendered_pack_idx" ON "rendered_pack_verifications" USING btree ("rendered_pack_id");--> statement-breakpoint
CREATE INDEX "verifications_status_idx" ON "rendered_pack_verifications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "verifications_expires_at_idx" ON "rendered_pack_verifications" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "verifications_nonce_unique_idx" ON "rendered_pack_verifications" USING btree ("nonce");--> statement-breakpoint
CREATE UNIQUE INDEX "rendered_packs_pack_cid_unique_idx" ON "rendered_packs" USING btree ("pack_cid");--> statement-breakpoint
CREATE INDEX "rendered_packs_source_pack_idx" ON "rendered_packs" USING btree ("source_pack_id");--> statement-breakpoint
CREATE INDEX "rendered_packs_diary_idx" ON "rendered_packs" USING btree ("diary_id");--> statement-breakpoint
CREATE INDEX "rendered_packs_expires_at_idx" ON "rendered_packs" USING btree ("expires_at") WHERE pinned = false;--> statement-breakpoint
CREATE INDEX "signing_requests_agent_status_idx" ON "signing_requests" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "signing_requests_signature_idx" ON "signing_requests" USING btree ("signature");--> statement-breakpoint
CREATE UNIQUE INDEX "signing_requests_workflow_idx" ON "signing_requests" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_invites_code_idx" ON "team_invites" USING btree ("code");--> statement-breakpoint
CREATE INDEX "team_invites_team_idx" ON "team_invites" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "teams_created_by_idx" ON "teams" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "used_recovery_nonces_expires_at_idx" ON "used_recovery_nonces" USING btree ("expires_at");
