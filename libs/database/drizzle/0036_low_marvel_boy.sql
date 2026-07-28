ALTER TABLE "runtime_profiles" ALTER COLUMN "runtime_kind" SET DATA TYPE varchar(100);--> statement-breakpoint
ALTER TABLE "runtime_profiles" ALTER COLUMN "runtime_kind" SET DEFAULT 'gondolin_pi';--> statement-breakpoint
ALTER TABLE "runtime_profiles" ADD COLUMN "required_executables" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_profiles" ADD CONSTRAINT "runtime_profiles_runtime_kind_valid" CHECK (runtime_kind ~ '^[a-z][a-z0-9._-]{0,99}$');--> statement-breakpoint
DROP TYPE "public"."runtime_profile_runtime_kind";
