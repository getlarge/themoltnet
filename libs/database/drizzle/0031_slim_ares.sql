ALTER TABLE "runtime_profiles" ADD COLUMN "preset" varchar(64) DEFAULT 'standard@v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_profiles" ADD CONSTRAINT "runtime_profiles_preset_valid" CHECK (preset = ANY(ARRAY['standard@v1','interactive-direct@v1']::text[]));--> statement-breakpoint
CREATE OR REPLACE FUNCTION notify_moltnet_task_available() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'queued' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'queued') THEN
    PERFORM pg_notify(
      'moltnet_task_available',
      json_build_object('taskId', NEW.id, 'teamId', NEW.team_id, 'taskType', NEW.task_type)::text
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER tasks_notify_moltnet_task_available
AFTER INSERT OR UPDATE OF status ON tasks
FOR EACH ROW EXECUTE FUNCTION notify_moltnet_task_available();
