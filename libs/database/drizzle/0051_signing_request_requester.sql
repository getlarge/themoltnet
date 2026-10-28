-- Replace the Kratos-identity `agent_id` (no foreign key) and the
-- `requested_by` jsonb with requester columns keyed on `agents.id` /
-- `humans.id`. Identities are recreatable; principal rows are not.
ALTER TABLE "signing_requests" ADD COLUMN "requester_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "signing_requests" ADD COLUMN "requester_human_id" uuid;--> statement-breakpoint
-- 1. The identity still belongs to a principal.
UPDATE "signing_requests" sr SET "requester_agent_id" = a."id"
FROM "agents" a WHERE a."identity_id" = sr."agent_id";--> statement-breakpoint
UPDATE "signing_requests" sr SET "requester_human_id" = h."id"
FROM "humans" h
WHERE h."identity_id" = sr."agent_id" AND sr."requester_agent_id" IS NULL;--> statement-breakpoint
-- 2. `requested_by` recorded the principal id itself.
UPDATE "signing_requests" sr SET "requester_agent_id" = a."id"
FROM "agents" a
WHERE sr."requester_agent_id" IS NULL AND sr."requester_human_id" IS NULL
  AND sr."requested_by"->>'type' = 'agent'
  AND a."id"::text = sr."requested_by"->>'id';--> statement-breakpoint
UPDATE "signing_requests" sr SET "requester_human_id" = h."id"
FROM "humans" h
WHERE sr."requester_agent_id" IS NULL AND sr."requester_human_id" IS NULL
  AND sr."requested_by"->>'type' = 'human'
  AND h."id"::text = sr."requested_by"->>'id';--> statement-breakpoint
-- 3. The signing workflow recorded the key it checked the signature with.
-- `agent_identity_keys` holds every key an agent has had, current included.
UPDATE "signing_requests" sr SET "requester_agent_id" = k."agent_id"
FROM "agent_identity_keys" k
WHERE sr."requester_agent_id" IS NULL AND sr."requester_human_id" IS NULL
  AND k."public_key" = sr."signer_public_key";--> statement-breakpoint
-- 4. The request's verified signature backs an entry; only its requester
-- could have created that entry. A failed request may carry a copied
-- signature, so it proves nothing.
UPDATE "signing_requests" sr SET "requester_agent_id" = e."creator_agent_id"
FROM "diary_entries" e
WHERE sr."requester_agent_id" IS NULL AND sr."requester_human_id" IS NULL
  AND sr."valid" AND e."content_signature" = sr."signature"
  AND e."creator_agent_id" IS NOT NULL;--> statement-breakpoint
-- 5. The identity's other requests go to the creator its signatures resolved
-- to, applied only when that creator is unique for the identity.
UPDATE "signing_requests" sr SET "requester_agent_id" = m."creator_agent_id"
FROM (
  SELECT s."agent_id", min(e."creator_agent_id"::text)::uuid AS "creator_agent_id"
  FROM "signing_requests" s
  JOIN "diary_entries" e ON e."content_signature" = s."signature"
  WHERE s."valid" AND e."creator_agent_id" IS NOT NULL
  GROUP BY s."agent_id"
  HAVING count(DISTINCT e."creator_agent_id") = 1
) m
WHERE sr."agent_id" = m."agent_id"
  AND sr."requester_agent_id" IS NULL AND sr."requester_human_id" IS NULL;--> statement-breakpoint
-- 6. Requests that resolve to no principal cannot be attributed and are
-- deleted; signatures they hold no longer verify.
DELETE FROM "signing_requests"
WHERE "requester_agent_id" IS NULL AND "requester_human_id" IS NULL;--> statement-breakpoint
ALTER TABLE "signing_requests" DROP CONSTRAINT "signing_requests_delegated_context";--> statement-breakpoint
DROP INDEX "signing_requests_agent_status_idx";--> statement-breakpoint
DROP INDEX "signing_requests_active_pending_idx";--> statement-breakpoint
DROP INDEX "signing_requests_requested_by_idx";--> statement-breakpoint
ALTER TABLE "signing_requests" ADD CONSTRAINT "signing_requests_requester_agent_id_agents_id_fk" FOREIGN KEY ("requester_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_requests" ADD CONSTRAINT "signing_requests_requester_human_id_humans_id_fk" FOREIGN KEY ("requester_human_id") REFERENCES "public"."humans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signing_requests_requester_agent_status_idx" ON "signing_requests" USING btree ("requester_agent_id","status");--> statement-breakpoint
CREATE INDEX "signing_requests_requester_human_status_idx" ON "signing_requests" USING btree ("requester_human_id","status");--> statement-breakpoint
CREATE INDEX "signing_requests_active_pending_agent_idx" ON "signing_requests" USING btree ("requester_agent_id","expires_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "signing_requests_active_pending_human_idx" ON "signing_requests" USING btree ("requester_human_id","expires_at") WHERE status = 'pending';--> statement-breakpoint
ALTER TABLE "signing_requests" DROP COLUMN "agent_id";--> statement-breakpoint
ALTER TABLE "signing_requests" DROP COLUMN "requested_by";--> statement-breakpoint
ALTER TABLE "signing_requests" ADD CONSTRAINT "signing_requests_requester_xor" CHECK ((requester_agent_id IS NOT NULL) <> (requester_human_id IS NOT NULL));--> statement-breakpoint
ALTER TABLE "signing_requests" ADD CONSTRAINT "signing_requests_delegated_context" CHECK (verification_method = 'agent-ed25519' OR (team_id IS NOT NULL AND signer_constraint IS NOT NULL));
