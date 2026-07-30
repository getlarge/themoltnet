-- Credential evidence is an audit trail: rows may be appended and, once past
-- the retention window, deleted — but never rewritten. Enforce that in the
-- database so an application bug (or a hand-run UPDATE) cannot revise history.
--
-- DELETE stays permitted so the retention prune can age rows out by
-- occurred_at. See libs/database/src/schema/credential-evidence-events.ts.

CREATE OR REPLACE FUNCTION prevent_credential_evidence_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'credential_evidence_events is append-only. Emit a new evidence event instead of updating %.', OLD.id;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS credential_evidence_events_append_only ON "credential_evidence_events";
--> statement-breakpoint
CREATE TRIGGER credential_evidence_events_append_only
  BEFORE UPDATE ON "credential_evidence_events"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_credential_evidence_update();
