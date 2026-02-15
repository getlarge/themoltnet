CREATE TABLE "used_recovery_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "used_recovery_nonces_expires_at_idx" ON "used_recovery_nonces" USING btree ("expires_at");
