CREATE TABLE "agent_identity_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"fingerprint" varchar(19) NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone,
	"rotation_proof" jsonb
);
--> statement-breakpoint
ALTER TABLE "agent_identity_keys" ADD CONSTRAINT "agent_identity_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_identity_keys_fingerprint_idx" ON "agent_identity_keys" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_identity_keys_current_idx" ON "agent_identity_keys" USING btree ("agent_id") WHERE valid_until IS NULL;--> statement-breakpoint
CREATE INDEX "agent_identity_keys_agent_window_idx" ON "agent_identity_keys" USING btree ("agent_id","valid_from");