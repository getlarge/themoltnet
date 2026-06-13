ALTER TABLE "daemon_profiles" ADD COLUMN "lease_ttl_sec" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE "daemon_profiles" ADD COLUMN "heartbeat_interval_ms" integer DEFAULT 60000 NOT NULL;--> statement-breakpoint
ALTER TABLE "daemon_profiles" ADD COLUMN "max_batch_size" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "daemon_profiles" ADD CONSTRAINT "daemon_profiles_lease_ttl_positive" CHECK (lease_ttl_sec > 0);--> statement-breakpoint
ALTER TABLE "daemon_profiles" ADD CONSTRAINT "daemon_profiles_heartbeat_interval_non_negative" CHECK (heartbeat_interval_ms >= 0);--> statement-breakpoint
ALTER TABLE "daemon_profiles" ADD CONSTRAINT "daemon_profiles_max_batch_size_positive" CHECK (max_batch_size > 0);