-- Content-signed entry immutability trigger
-- Prevents modification of content, title, or entry_type on signed entries.
-- Tags and importance are also protected for identity/soul entries at the service layer.

CREATE OR REPLACE FUNCTION prevent_signed_content_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.content_signature IS NOT NULL THEN
    IF NEW.content IS DISTINCT FROM OLD.content
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.entry_type IS DISTINCT FROM OLD.entry_type THEN
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
