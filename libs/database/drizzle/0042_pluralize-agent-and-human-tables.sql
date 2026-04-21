ALTER TABLE "agent_keys" RENAME TO "agents";--> statement-breakpoint
ALTER TABLE "human" RENAME TO "humans";--> statement-breakpoint
ALTER INDEX "agent_keys_fingerprint_idx" RENAME TO "agents_fingerprint_idx";--> statement-breakpoint
-- Idempotent trigger rename: in prod the source trigger may be absent
-- (baseline skipped 0002 or dropped later), so we drop both possible
-- names and recreate under the new one rather than ALTER TRIGGER ...
-- RENAME, which has no IF EXISTS variant and errors with 42704 if the
-- source trigger is missing.
-- Ensure the trigger function exists before (re)creating the trigger.
-- Prod was baselined from a state where 0002 did not run, so
-- update_updated_at_column is missing there. CREATE OR REPLACE is a
-- no-op where it already exists.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS update_agent_keys_updated_at ON "agents";--> statement-breakpoint
DROP TRIGGER IF EXISTS update_agents_updated_at ON "agents";--> statement-breakpoint
CREATE TRIGGER update_agents_updated_at
    BEFORE UPDATE ON "agents"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();--> statement-breakpoint
COMMENT ON TABLE agents IS 'Cache of agent Ed25519 public keys for quick lookups';--> statement-breakpoint
COMMENT ON TABLE humans IS 'Minimal record for human users created during Kratos self-service registration';
