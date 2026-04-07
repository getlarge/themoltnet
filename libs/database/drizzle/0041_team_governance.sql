CREATE TYPE "public"."diary_transfer_status" AS ENUM('pending', 'accepted', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."founding_acceptance_status" AS ENUM('pending', 'accepted');--> statement-breakpoint
CREATE TABLE "founding_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"subject_ns" varchar(20) NOT NULL,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"status" "founding_acceptance_status" DEFAULT 'pending' NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diary_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"diary_id" uuid NOT NULL,
	"source_team_id" uuid NOT NULL,
	"destination_team_id" uuid NOT NULL,
	"workflow_id" text NOT NULL,
	"status" "diary_transfer_status" DEFAULT 'pending' NOT NULL,
	"initiated_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "founding_acceptances" ADD CONSTRAINT "founding_acceptances_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_transfers" ADD CONSTRAINT "diary_transfers_diary_id_diaries_id_fk" FOREIGN KEY ("diary_id") REFERENCES "public"."diaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_transfers" ADD CONSTRAINT "diary_transfers_source_team_id_teams_id_fk" FOREIGN KEY ("source_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_transfers" ADD CONSTRAINT "diary_transfers_destination_team_id_teams_id_fk" FOREIGN KEY ("destination_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "founding_acceptances_team_idx" ON "founding_acceptances" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "founding_acceptances_team_subject_idx" ON "founding_acceptances" USING btree ("team_id","subject_id");--> statement-breakpoint
CREATE INDEX "diary_transfers_diary_idx" ON "diary_transfers" USING btree ("diary_id");--> statement-breakpoint
CREATE INDEX "diary_transfers_source_team_idx" ON "diary_transfers" USING btree ("source_team_id");--> statement-breakpoint
CREATE INDEX "diary_transfers_dest_team_idx" ON "diary_transfers" USING btree ("destination_team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "diary_transfers_workflow_idx" ON "diary_transfers" USING btree ("workflow_id");
