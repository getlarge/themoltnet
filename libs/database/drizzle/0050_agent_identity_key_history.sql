-- Custom SQL migration file, put your code below! --

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
