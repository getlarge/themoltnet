ALTER TABLE "context_packs" ALTER COLUMN "pack_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "context_packs" ALTER COLUMN "pack_type" SET DEFAULT 'custom'::text;--> statement-breakpoint
DROP TYPE "public"."pack_type";--> statement-breakpoint
CREATE TYPE "public"."pack_type" AS ENUM('optimized', 'custom');--> statement-breakpoint
ALTER TABLE "context_packs" ALTER COLUMN "pack_type" SET DEFAULT 'custom'::"public"."pack_type";--> statement-breakpoint
ALTER TABLE "context_packs" ALTER COLUMN "pack_type" SET DATA TYPE "public"."pack_type" USING "pack_type"::"public"."pack_type";