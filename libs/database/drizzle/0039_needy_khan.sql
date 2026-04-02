CREATE TABLE "rendered_pack_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rendered_pack_id" uuid NOT NULL,
	"nonce" uuid NOT NULL,
	"status" varchar(20) NOT NULL,
	"claimed_by" uuid,
	"claimed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rendered_pack_verifications" ADD CONSTRAINT "rendered_pack_verifications_rendered_pack_id_rendered_packs_id_fk" FOREIGN KEY ("rendered_pack_id") REFERENCES "public"."rendered_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verifications_rendered_pack_idx" ON "rendered_pack_verifications" USING btree ("rendered_pack_id");--> statement-breakpoint
CREATE INDEX "verifications_status_idx" ON "rendered_pack_verifications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "verifications_expires_at_idx" ON "rendered_pack_verifications" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "verifications_nonce_unique_idx" ON "rendered_pack_verifications" USING btree ("nonce");