CREATE TYPE "public"."verification_method" AS ENUM('agent-ed25519', 'human-hardware-previewsign');--> statement-breakpoint
ALTER TABLE "signing_requests" ADD COLUMN "verification_method" "verification_method" DEFAULT 'agent-ed25519' NOT NULL;--> statement-breakpoint
ALTER TABLE "signing_requests" ADD COLUMN "requested_by" jsonb;--> statement-breakpoint
ALTER TABLE "signing_requests" ADD COLUMN "signer_constraint" jsonb;