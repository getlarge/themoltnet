ALTER TABLE "runtime_profiles" DROP CONSTRAINT "runtime_profiles_session_ttl_positive";--> statement-breakpoint
ALTER TABLE "runtime_profiles" DROP CONSTRAINT "runtime_profiles_workspace_ttl_positive";--> statement-breakpoint
ALTER TABLE "runtime_profiles" DROP CONSTRAINT "runtime_profiles_lease_ttl_positive";--> statement-breakpoint
ALTER TABLE "runtime_profiles" DROP CONSTRAINT "runtime_profiles_heartbeat_interval_non_negative";--> statement-breakpoint
ALTER TABLE "runtime_profiles" DROP CONSTRAINT "runtime_profiles_max_batch_size_positive";--> statement-breakpoint
ALTER TABLE "runtime_profiles" DROP COLUMN "session_storage_mode";--> statement-breakpoint
ALTER TABLE "runtime_profiles" DROP COLUMN "workspace_storage_mode";--> statement-breakpoint
ALTER TABLE "runtime_profiles" DROP COLUMN "session_ttl_sec";--> statement-breakpoint
ALTER TABLE "runtime_profiles" DROP COLUMN "workspace_ttl_sec";--> statement-breakpoint
ALTER TABLE "runtime_profiles" DROP COLUMN "lease_ttl_sec";--> statement-breakpoint
ALTER TABLE "runtime_profiles" DROP COLUMN "heartbeat_interval_ms";--> statement-breakpoint
ALTER TABLE "runtime_profiles" DROP COLUMN "max_batch_size";--> statement-breakpoint
DROP TYPE "public"."runtime_profile_storage_mode";