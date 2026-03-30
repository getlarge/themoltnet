CREATE TYPE "public"."team_invite_role" AS ENUM('manager', 'member');--> statement-breakpoint
CREATE TYPE "public"."team_status" AS ENUM('founding', 'active', 'archived');--> statement-breakpoint
CREATE TABLE "team_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"role" "team_invite_role" DEFAULT 'member' NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" "team_status" DEFAULT 'active' NOT NULL,
	"personal" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diaries" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_invites_code_idx" ON "team_invites" USING btree ("code");--> statement-breakpoint
CREATE INDEX "team_invites_team_idx" ON "team_invites" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "teams_created_by_idx" ON "teams" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "diaries_team_idx" ON "diaries" USING btree ("team_id");