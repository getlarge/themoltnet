CREATE TABLE "runtime_conversation_heads" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime_conversation_records" (
	"store_id" uuid NOT NULL,
	"type" text NOT NULL,
	"id" bigint NOT NULL,
	"seq" integer NOT NULL,
	"conversation_id" bigint,
	"address" text,
	"value" jsonb NOT NULL,
	CONSTRAINT "runtime_conversation_records_store_id_type_id_seq_pk" PRIMARY KEY("store_id","type","id","seq")
);
--> statement-breakpoint
ALTER TABLE "runtime_conversation_heads" ADD CONSTRAINT "runtime_conversation_heads_store_id_runtime_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."runtime_stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_conversation_records" ADD CONSTRAINT "runtime_conversation_records_store_id_runtime_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."runtime_stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runtime_conversation_entries_idx" ON "runtime_conversation_records" USING btree ("store_id","type","conversation_id","id");--> statement-breakpoint
CREATE INDEX "runtime_conversation_address_idx" ON "runtime_conversation_records" USING btree ("store_id","address","seq");--> statement-breakpoint
CREATE INDEX "runtime_store_commits_attempt_seq_idx" ON "runtime_store_commits" USING btree ("store_id","task_id","attempt_n","seq");