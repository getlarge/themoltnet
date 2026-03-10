CREATE TYPE "public"."compression_level" AS ENUM('full', 'summary', 'keywords');--> statement-breakpoint
CREATE TYPE "public"."relation_status" AS ENUM('proposed', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."relation_type" AS ENUM('supersedes', 'elaborates', 'contradicts', 'supports', 'caused_by', 'references');--> statement-breakpoint
CREATE TABLE "context_pack_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"entry_cid_snapshot" varchar(100) NOT NULL,
	"compression_level" "compression_level" DEFAULT 'full' NOT NULL,
	"original_tokens" integer,
	"packed_tokens" integer,
	"rank" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"diary_id" uuid NOT NULL,
	"pack_cid" varchar(100) NOT NULL,
	"pack_codec" varchar(50) DEFAULT 'dag-cbor' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"task_prompt_hash" text,
	"token_budget" integer NOT NULL,
	"lambda" real,
	"w_recency" real,
	"w_importance" real,
	"created_by" uuid,
	"supersedes_pack_id" uuid,
	"pinned" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone DEFAULT (now() + interval '7 days'),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entry_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"relation" "relation_type" NOT NULL,
	"status" "relation_status" DEFAULT 'proposed' NOT NULL,
	"source_cid_snapshot" varchar(100),
	"target_cid_snapshot" varchar(100),
	"workflow_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "context_pack_entries" ADD CONSTRAINT "context_pack_entries_pack_id_context_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."context_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_pack_entries" ADD CONSTRAINT "context_pack_entries_entry_id_diary_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."diary_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_packs" ADD CONSTRAINT "context_packs_diary_id_diaries_id_fk" FOREIGN KEY ("diary_id") REFERENCES "public"."diaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_packs" ADD CONSTRAINT "context_packs_supersedes_pack_id_context_packs_id_fk" FOREIGN KEY ("supersedes_pack_id") REFERENCES "public"."context_packs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_relations" ADD CONSTRAINT "entry_relations_source_id_diary_entries_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."diary_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_relations" ADD CONSTRAINT "entry_relations_target_id_diary_entries_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."diary_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "context_pack_entries_unique_idx" ON "context_pack_entries" USING btree ("pack_id","entry_id");--> statement-breakpoint
CREATE INDEX "context_pack_entries_pack_idx" ON "context_pack_entries" USING btree ("pack_id");--> statement-breakpoint
CREATE INDEX "context_pack_entries_entry_idx" ON "context_pack_entries" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "context_packs_pack_cid_unique_idx" ON "context_packs" USING btree ("pack_cid");--> statement-breakpoint
CREATE INDEX "context_packs_diary_idx" ON "context_packs" USING btree ("diary_id");--> statement-breakpoint
CREATE INDEX "context_packs_expires_at_idx" ON "context_packs" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "context_packs_pinned_idx" ON "context_packs" USING btree ("pinned");--> statement-breakpoint
CREATE UNIQUE INDEX "entry_relations_unique_idx" ON "entry_relations" USING btree ("source_id","target_id","relation");--> statement-breakpoint
CREATE INDEX "entry_relations_source_idx" ON "entry_relations" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "entry_relations_target_idx" ON "entry_relations" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "entry_relations_type_idx" ON "entry_relations" USING btree ("relation");--> statement-breakpoint
CREATE INDEX "entry_relations_status_idx" ON "entry_relations" USING btree ("status");