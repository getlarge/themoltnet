ALTER TABLE "diary_entries" ADD COLUMN "signer_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "diary_entries" ADD COLUMN "signer_public_key" text;--> statement-breakpoint
ALTER TABLE "diary_entries" ADD COLUMN "signer_fingerprint" varchar(19);--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_signer_agent_id_agents_id_fk" FOREIGN KEY ("signer_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_signer_complete" CHECK ((signer_agent_id IS NULL AND signer_public_key IS NULL AND signer_fingerprint IS NULL) OR (signer_agent_id IS NOT NULL AND signer_public_key IS NOT NULL AND signer_fingerprint IS NOT NULL AND content_signature IS NOT NULL));