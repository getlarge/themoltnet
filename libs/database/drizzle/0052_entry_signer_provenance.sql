-- Signer provenance is immutable once recorded. A NULL -> value transition is
-- still allowed, so the backfill below (and any later one) can fill legacy
-- rows without disabling the trigger.
CREATE OR REPLACE FUNCTION prevent_signed_content_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.content_signature IS NOT NULL THEN
    IF NEW.title IS DISTINCT FROM OLD.title
       OR NEW.content IS DISTINCT FROM OLD.content
       OR NEW.tags IS DISTINCT FROM OLD.tags
       OR NEW.entry_type IS DISTINCT FROM OLD.entry_type
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
       OR NEW.content_signature IS DISTINCT FROM OLD.content_signature
       OR NEW.signing_nonce IS DISTINCT FROM OLD.signing_nonce THEN
      RAISE EXCEPTION
        'Cannot modify content of a signed diary entry. Create a new entry and relate it with a supersedes relation.';
    END IF;
  END IF;
  IF OLD.signer_public_key IS NOT NULL
     AND (NEW.signer_agent_id IS DISTINCT FROM OLD.signer_agent_id
          OR NEW.signer_public_key IS DISTINCT FROM OLD.signer_public_key
          OR NEW.signer_fingerprint IS DISTINCT FROM OLD.signer_fingerprint) THEN
    RAISE EXCEPTION 'Cannot modify the recorded signer of a diary entry.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- Backfill signed entries whose signing request recorded the key the signing
-- workflow verified with. `signing_requests.agent_id` holds the Kratos
-- identity, so it joins on `agents.identity_id`. The recorded key must be one
-- the agent holds or held. Entries signed before the key was recorded stay
-- NULL: the verify endpoint keeps its signing-request fallback for them, which
-- checks the signature cryptographically against the agent's key history.
UPDATE "diary_entries" AS de
SET
  signer_agent_id = a.id,
  signer_public_key = sr.signer_public_key,
  signer_fingerprint = COALESCE(k.fingerprint, a.fingerprint)
FROM "signing_requests" AS sr
JOIN "agents" AS a ON a.identity_id = sr.agent_id
LEFT JOIN "agent_identity_keys" AS k
  ON k.agent_id = a.id AND k.public_key = sr.signer_public_key
WHERE de.content_signature IS NOT NULL
  AND de.signer_public_key IS NULL
  AND sr.signature = de.content_signature
  AND sr.status = 'completed'
  AND sr.valid IS TRUE
  AND sr.signer_public_key IS NOT NULL
  AND (k.id IS NOT NULL OR sr.signer_public_key = a.public_key);
