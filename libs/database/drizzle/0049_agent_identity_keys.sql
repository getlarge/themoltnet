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
CREATE INDEX "agent_identity_keys_agent_window_idx" ON "agent_identity_keys" USING btree ("agent_id","valid_from");--> statement-breakpoint

-- Every existing agent's current key opens its history at registration time.
INSERT INTO "agent_identity_keys" ("agent_id", "public_key", "fingerprint", "valid_from")
SELECT "id", "public_key", "fingerprint", "created_at" FROM "agents"
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Keep agent_identity_keys in step with agents.public_key for every writer
-- (registration, bootstrap, rotation). A changed key closes the current row
-- and opens a new one at the same instant. A fingerprint already present in
-- the history — another agent's, or one this agent retired — violates
-- agent_identity_keys_fingerprint_idx and aborts the write to agents.
CREATE OR REPLACE FUNCTION record_agent_identity_key()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.public_key IS NOT DISTINCT FROM OLD.public_key THEN
      RETURN NEW;
    END IF;
    UPDATE "agent_identity_keys"
      SET "valid_until" = now()
      WHERE "agent_id" = NEW."id" AND "valid_until" IS NULL;
  END IF;
  INSERT INTO "agent_identity_keys" ("agent_id", "public_key", "fingerprint", "valid_from")
  VALUES (NEW."id", NEW."public_key", NEW."fingerprint", now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS agents_identity_key_history ON "agents";
--> statement-breakpoint
CREATE TRIGGER agents_identity_key_history
  AFTER INSERT OR UPDATE OF "public_key" ON "agents"
  FOR EACH ROW
  EXECUTE FUNCTION record_agent_identity_key();
