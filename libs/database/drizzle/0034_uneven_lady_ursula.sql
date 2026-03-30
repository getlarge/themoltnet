CREATE TABLE "rendered_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_cid" varchar(100) NOT NULL,
	"source_pack_id" uuid NOT NULL,
	"diary_id" uuid NOT NULL,
	"content" text NOT NULL,
	"content_hash" varchar(100) NOT NULL,
	"render_method" varchar(100) NOT NULL,
	"total_tokens" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone DEFAULT (now() + interval '7 days'),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rendered_packs" ADD CONSTRAINT "rendered_packs_source_pack_id_context_packs_id_fk" FOREIGN KEY ("source_pack_id") REFERENCES "public"."context_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rendered_packs" ADD CONSTRAINT "rendered_packs_diary_id_diaries_id_fk" FOREIGN KEY ("diary_id") REFERENCES "public"."diaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rendered_packs_pack_cid_unique_idx" ON "rendered_packs" USING btree ("pack_cid");--> statement-breakpoint
CREATE INDEX "rendered_packs_source_pack_idx" ON "rendered_packs" USING btree ("source_pack_id");--> statement-breakpoint
CREATE INDEX "rendered_packs_diary_idx" ON "rendered_packs" USING btree ("diary_id");--> statement-breakpoint
CREATE INDEX "rendered_packs_expires_at_idx" ON "rendered_packs" USING btree ("expires_at") WHERE pinned = false;--> statement-breakpoint
CREATE INDEX "rendered_packs_pinned_idx" ON "rendered_packs" USING btree ("pinned");