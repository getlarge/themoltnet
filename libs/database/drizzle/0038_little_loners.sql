CREATE TABLE "rendered_pack_attestations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rendered_pack_id" uuid NOT NULL,
	"coverage" real NOT NULL,
	"grounding" real NOT NULL,
	"faithfulness" real NOT NULL,
	"composite" real NOT NULL,
	"judge_model" varchar(100) NOT NULL,
	"judge_provider" varchar(50) NOT NULL,
	"judge_binary_cid" varchar(100) NOT NULL,
	"rubric_cid" varchar(100),
	"created_by" uuid NOT NULL,
	"transcript" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rendered_pack_attestations" ADD CONSTRAINT "rendered_pack_attestations_rendered_pack_id_rendered_packs_id_fk" FOREIGN KEY ("rendered_pack_id") REFERENCES "public"."rendered_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attestations_rendered_pack_idx" ON "rendered_pack_attestations" USING btree ("rendered_pack_id");--> statement-breakpoint
CREATE INDEX "attestations_composite_idx" ON "rendered_pack_attestations" USING btree ("composite");