CREATE TABLE "executor_manifest_registrations" (
	"fingerprint" varchar(100) NOT NULL,
	"agent_identity_id" uuid NOT NULL,
	"signature" text NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "executor_manifest_registrations_fingerprint_agent_identity_id_pk" PRIMARY KEY("fingerprint","agent_identity_id")
);
--> statement-breakpoint
ALTER TABLE "executor_manifest_registrations" ADD CONSTRAINT "executor_manifest_registrations_fingerprint_executor_manifests_fingerprint_fk" FOREIGN KEY ("fingerprint") REFERENCES "public"."executor_manifests"("fingerprint") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executor_manifest_registrations" ADD CONSTRAINT "executor_manifest_registrations_agent_identity_id_agents_identity_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agents"("identity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "executor_manifest_registrations_agent_idx" ON "executor_manifest_registrations" USING btree ("agent_identity_id","registered_at");