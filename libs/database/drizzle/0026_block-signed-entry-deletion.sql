-- Defense-in-depth: prevent deletion of content-signed diary entries via direct SQL.
-- The diary-service layer enforces the same rule, but this trigger catches bypass attempts.

CREATE OR REPLACE FUNCTION prevent_signed_entry_deletion()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.content_signature IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot delete a content-signed diary entry. Use superseded_by to version it instead.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER diary_entries_no_signed_delete
  BEFORE DELETE ON diary_entries
  FOR EACH ROW
  EXECUTE FUNCTION prevent_signed_entry_deletion();
