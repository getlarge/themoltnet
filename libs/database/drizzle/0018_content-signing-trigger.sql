-- Content-signed entry immutability trigger
-- Defense-in-depth: prevents modification of signed entry fields via direct SQL.
-- The service layer enforces the same rules, but this trigger catches bypass attempts.
-- Note: importance is NOT checked here — the service layer applies per-type policy
-- (blocked on identity/soul/reflection, allowed on semantic/procedural/episodic).

CREATE OR REPLACE FUNCTION prevent_signed_content_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.content_signature IS NOT NULL THEN
    IF NEW.content IS DISTINCT FROM OLD.content
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.entry_type IS DISTINCT FROM OLD.entry_type
       OR NEW.tags IS DISTINCT FROM OLD.tags
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
       OR NEW.content_signature IS DISTINCT FROM OLD.content_signature
       OR NEW.signing_nonce IS DISTINCT FROM OLD.signing_nonce THEN
      RAISE EXCEPTION 'Cannot modify content of a signed diary entry. Create a new entry and set superseded_by on this one.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER diary_entries_immutable_content
  BEFORE UPDATE ON diary_entries
  FOR EACH ROW
  EXECUTE FUNCTION prevent_signed_content_update();
