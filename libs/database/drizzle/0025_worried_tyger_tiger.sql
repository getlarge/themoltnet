DROP INDEX "runtime_slots_profile_identity_idx";--> statement-breakpoint
DROP INDEX "runtime_slots_legacy_identity_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_slots_identity_idx" ON "runtime_slots" USING btree ("team_id","agent_name","daemon_profile_id","slot_key");