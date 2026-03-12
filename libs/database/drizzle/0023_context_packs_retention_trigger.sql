-- Context pack retention guardrails
--
-- Invariants:
-- 1) pinned packs must not expire (expires_at = NULL)
-- 2) non-pinned packs must have an expiry timestamp in the future

ALTER TABLE "context_packs"
  ADD CONSTRAINT "context_packs_pin_expiry_ck"
  CHECK (
    (pinned = true AND expires_at IS NULL)
    OR
    (pinned = false AND expires_at IS NOT NULL)
  );

-- Single GC index path for expired, non-pinned packs.
CREATE INDEX IF NOT EXISTS "context_packs_expires_at_idx"
  ON "context_packs" USING btree ("expires_at")
  WHERE "pinned" = false;

CREATE OR REPLACE FUNCTION enforce_context_pack_retention()
RETURNS TRIGGER AS $$
BEGIN
  -- Pinning a pack always clears expiry.
  IF NEW.pinned = true THEN
    NEW.expires_at := NULL;
  END IF;

  -- Unpinned packs require explicit expiry.
  IF NEW.pinned = false AND NEW.expires_at IS NULL THEN
    RAISE EXCEPTION
      'Non-pinned context packs must have expires_at';
  END IF;

  -- Expiry must remain in the future.
  IF NEW.pinned = false AND NEW.expires_at <= now() THEN
    RAISE EXCEPTION
      'expires_at must be in the future for non-pinned context packs';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS context_packs_retention_guard ON "context_packs";
CREATE TRIGGER context_packs_retention_guard
  BEFORE INSERT OR UPDATE OF pinned, expires_at
  ON "context_packs"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_context_pack_retention();
