DROP INDEX "runtime_slots_identity_idx";--> statement-breakpoint
ALTER TYPE "daemon_profile_runtime_kind" RENAME TO "runtime_profile_runtime_kind";--> statement-breakpoint
ALTER TYPE "daemon_profile_storage_mode" RENAME TO "runtime_profile_storage_mode";--> statement-breakpoint
ALTER TABLE "daemon_profiles" RENAME TO "runtime_profiles";--> statement-breakpoint
ALTER INDEX "daemon_profiles_team_name_idx" RENAME TO "runtime_profiles_team_name_idx";--> statement-breakpoint
ALTER INDEX "daemon_profiles_team_idx" RENAME TO "runtime_profiles_team_idx";--> statement-breakpoint
ALTER TABLE "runtime_profiles" RENAME CONSTRAINT "daemon_profiles_team_id_teams_id_fk" TO "runtime_profiles_team_id_teams_id_fk";--> statement-breakpoint
ALTER TABLE "runtime_profiles" RENAME CONSTRAINT "daemon_profiles_created_by_agent_id_agents_identity_id_fk" TO "runtime_profiles_created_by_agent_id_agents_identity_id_fk";--> statement-breakpoint
ALTER TABLE "runtime_profiles" RENAME CONSTRAINT "daemon_profiles_created_by_human_id_humans_id_fk" TO "runtime_profiles_created_by_human_id_humans_id_fk";--> statement-breakpoint
ALTER TABLE "runtime_profiles" RENAME CONSTRAINT "daemon_profiles_creator_xor" TO "runtime_profiles_creator_xor";--> statement-breakpoint
ALTER TABLE "runtime_profiles" RENAME CONSTRAINT "daemon_profiles_session_ttl_positive" TO "runtime_profiles_session_ttl_positive";--> statement-breakpoint
ALTER TABLE "runtime_profiles" RENAME CONSTRAINT "daemon_profiles_workspace_ttl_positive" TO "runtime_profiles_workspace_ttl_positive";--> statement-breakpoint
ALTER TABLE "runtime_profiles" RENAME CONSTRAINT "daemon_profiles_lease_ttl_positive" TO "runtime_profiles_lease_ttl_positive";--> statement-breakpoint
ALTER TABLE "runtime_profiles" RENAME CONSTRAINT "daemon_profiles_heartbeat_interval_non_negative" TO "runtime_profiles_heartbeat_interval_non_negative";--> statement-breakpoint
ALTER TABLE "runtime_profiles" RENAME CONSTRAINT "daemon_profiles_max_batch_size_positive" TO "runtime_profiles_max_batch_size_positive";--> statement-breakpoint
ALTER TABLE "runtime_slots" RENAME COLUMN "daemon_profile_id" TO "runtime_profile_id";--> statement-breakpoint
ALTER TABLE "runtime_slots" RENAME CONSTRAINT "runtime_slots_daemon_profile_id_daemon_profiles_id_fk" TO "runtime_slots_runtime_profile_id_runtime_profiles_id_fk";--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_slots_identity_idx" ON "runtime_slots" USING btree ("team_id","agent_name","runtime_profile_id","slot_key");
