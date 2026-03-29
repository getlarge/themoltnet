ALTER TYPE "public"."pack_type" ADD VALUE 'rendered';--> statement-breakpoint
ALTER TABLE "context_packs" ADD COLUMN "source_pack_id" uuid;--> statement-breakpoint
ALTER TABLE "context_packs" ADD CONSTRAINT "context_packs_source_pack_id_context_packs_id_fk" FOREIGN KEY ("source_pack_id") REFERENCES "public"."context_packs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "context_packs_rendered_unique_idx" ON "context_packs" USING btree ("source_pack_id") WHERE pack_type = 'rendered' AND source_pack_id IS NOT NULL;