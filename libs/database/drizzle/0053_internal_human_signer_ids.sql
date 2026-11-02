-- A human signer constraint names humans.id. Earlier API versions also accepted
-- the Kratos identity ID, so translate any row whose identity is still bound.
-- Preserve every other field, including historical request evidence.
UPDATE "signing_requests" AS request
SET "signer_constraint" = jsonb_set(
  request."signer_constraint",
  '{id}',
  to_jsonb(human."id"::text),
  false
)
FROM "humans" AS human
WHERE request."signer_constraint"->>'type' = 'human'
  AND request."signer_constraint"->>'id' = human."identity_id"::text
  AND human."id"::text <> human."identity_id"::text;
--> statement-breakpoint
-- An active request that still names neither a humans.id nor a currently
-- bound identity cannot be repaired from the database alone. Fail the
-- migration so that it cannot silently become unclaimable after deployment.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "signing_requests" AS request
    WHERE request."status" IN ('pending', 'claimed')
      AND request."expires_at" > now()
      AND request."signer_constraint"->>'type' = 'human'
      AND NOT EXISTS (
        SELECT 1
        FROM "humans" AS human
        WHERE human."id"::text = request."signer_constraint"->>'id'
      )
  ) THEN
    RAISE EXCEPTION 'Active human signer constraints need manual ID reconciliation';
  END IF;
END $$;
