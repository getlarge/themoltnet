ALTER TABLE "team_invites" ADD COLUMN "used_at" timestamp with time zone;--> statement-breakpoint
-- Retire all historical invites in both old and new readers.
UPDATE "team_invites" SET "used_at" = CURRENT_TIMESTAMP, "max_uses" = 1, "use_count" = 1;--> statement-breakpoint
-- Retained only while old binaries drain during rolling deployment.
CREATE FUNCTION sync_single_use_team_invite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.max_uses := 1;
  IF TG_OP = 'INSERT' THEN
    IF NEW.use_count > 0 AND NEW.used_at IS NULL THEN NEW.used_at := clock_timestamp(); END IF;
  ELSIF NEW.use_count IS DISTINCT FROM OLD.use_count AND NEW.used_at IS NOT DISTINCT FROM OLD.used_at THEN
    IF NEW.use_count > 1 THEN RAISE EXCEPTION 'team invitation is single-use'; END IF;
    IF NEW.use_count = 0 THEN NEW.used_at := NULL;
    ELSE NEW.used_at := clock_timestamp(); END IF;
  END IF;
  NEW.use_count := CASE WHEN NEW.used_at IS NULL THEN 0 ELSE 1 END;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER team_invites_single_use BEFORE INSERT OR UPDATE ON team_invites
FOR EACH ROW EXECUTE FUNCTION sync_single_use_team_invite();
