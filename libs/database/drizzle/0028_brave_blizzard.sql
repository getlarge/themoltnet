ALTER TABLE "runtime_profiles" ADD COLUMN "temperature" double precision;--> statement-breakpoint
ALTER TABLE "runtime_profiles" ADD COLUMN "top_p" double precision;--> statement-breakpoint
ALTER TABLE "runtime_profiles" ADD COLUMN "top_k" integer;--> statement-breakpoint
ALTER TABLE "runtime_profiles" ADD COLUMN "max_output_tokens" integer;--> statement-breakpoint
ALTER TABLE "runtime_profiles" ADD CONSTRAINT "runtime_profiles_temperature_range" CHECK (temperature IS NULL OR (temperature >= 0 AND temperature <= 2));--> statement-breakpoint
ALTER TABLE "runtime_profiles" ADD CONSTRAINT "runtime_profiles_top_p_range" CHECK (top_p IS NULL OR (top_p >= 0 AND top_p <= 1));--> statement-breakpoint
ALTER TABLE "runtime_profiles" ADD CONSTRAINT "runtime_profiles_top_k_positive" CHECK (top_k IS NULL OR top_k > 0);--> statement-breakpoint
ALTER TABLE "runtime_profiles" ADD CONSTRAINT "runtime_profiles_max_output_tokens_positive" CHECK (max_output_tokens IS NULL OR max_output_tokens > 0);