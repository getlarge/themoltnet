ALTER TABLE "agent_keys" RENAME TO "agents";--> statement-breakpoint
ALTER TABLE "human" RENAME TO "humans";--> statement-breakpoint
ALTER INDEX "agent_keys_fingerprint_idx" RENAME TO "agents_fingerprint_idx";--> statement-breakpoint
ALTER TRIGGER update_agent_keys_updated_at ON "agents" RENAME TO update_agents_updated_at;--> statement-breakpoint
COMMENT ON TABLE agents IS 'Cache of agent Ed25519 public keys for quick lookups';--> statement-breakpoint
COMMENT ON TABLE humans IS 'Minimal record for human users created during Kratos self-service registration';
