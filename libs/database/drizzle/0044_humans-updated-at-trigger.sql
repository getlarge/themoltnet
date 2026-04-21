-- Add BEFORE UPDATE trigger that maintains humans.updated_at automatically.
-- Mirrors the equivalent trigger on agents (see init.sql / migration history):
-- without it the app has to set updated_at by hand on every write (see
-- libs/database/src/repositories/human.repository.ts). The trigger hardens
-- the invariant so it cannot drift even if a future writer forgets.
--> statement-breakpoint
DROP TRIGGER IF EXISTS update_humans_updated_at ON "humans";--> statement-breakpoint
CREATE TRIGGER update_humans_updated_at
    BEFORE UPDATE ON "humans"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
