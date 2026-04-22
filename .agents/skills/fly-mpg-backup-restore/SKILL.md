---
name: fly-mpg-backup-restore
description: 'Use when working with Fly Managed Postgres backups, Fly MPG proxy access, pg_dump or pg_restore from a proxied production database, or when testing app/backfill behavior on a restored local copy of prod.'
---

# Fly MPG Backup Restore

Use the human-facing recipe as the source of truth for the exact commands and
restore procedure:

[docs/recipes/fly-mpg-backup-restore.md](../../../docs/recipes/fly-mpg-backup-restore.md)

## When to trigger

- Taking a local backup of the Fly database
- Restoring a local copy of prod for schema inspection
- Running backfills against real production data locally
- Testing the app against a restored local copy of prod

## Agent guidance

- Do not restate the procedure from memory. Follow the recipe.
- Treat the recipe as canonical for:
  - proxy setup
  - URL rewriting
  - `pg_dump` / `pg_restore`
  - extension precreation
  - restore verification
  - restored-db app startup
- Use `docker-compose.restore-test.yaml` only after the recipe has created the
  restored database container.
- If running from a sandboxed environment, call out when local proxy access or
  Docker networking needs escalation.
- Keep the skill focused on orchestration and verification, not duplicating the
  full runbook.
