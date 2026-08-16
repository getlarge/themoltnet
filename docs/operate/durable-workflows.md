# Durable Workflow Operations

Use this runbook to inventory DBOS executions, diagnose recovery, decide
whether a release may deploy, and roll back without abandoning workflows. All
inventory SQL below is read-only.

## Check service readiness

The REST API is ready only after DBOS launches, recovers interrupted work, and
registers persisted queues.

```bash
curl -fsS https://api.themolt.net/health/ready | jq .
```

At startup, find the `DBOS initialized` log record. It contains:

- `currentVersion`: the source hash of the running application
- `latestVersion`: the latest version known to DBOS
- `activeWorkflowsByVersion`: active executions grouped by application version

A healthy HTTP process without DBOS readiness is not ready for traffic.

## Read-only production inventory

Connect to the DBOS system database through the approved production database
access path. Keep the session read-only:

```sql
BEGIN TRANSACTION READ ONLY;

SELECT
  COALESCE(application_version, 'unassigned') AS application_version,
  status,
  count(*) AS workflows
FROM dbos.workflow_status
WHERE status IN ('PENDING', 'ENQUEUED', 'DELAYED')
GROUP BY 1, 2
ORDER BY 1, 2;

SELECT
  workflow_uuid,
  name,
  status,
  application_version,
  queue_name,
  recovery_attempts,
  to_timestamp(created_at / 1000.0) AS created_at,
  to_timestamp(updated_at / 1000.0) AS updated_at
FROM dbos.workflow_status
WHERE status IN (
  'PENDING',
  'ENQUEUED',
  'DELAYED',
  'ERROR',
  'MAX_RECOVERY_ATTEMPTS_EXCEEDED'
)
ORDER BY updated_at DESC
LIMIT 200;

ROLLBACK;
```

To inspect a known workflow without exposing serialized inputs or outputs:

```sql
SELECT
  workflow_uuid,
  name,
  status,
  application_version,
  queue_name,
  executor_id,
  recovery_attempts,
  workflow_deadline_epoch_ms,
  error
FROM dbos.workflow_status
WHERE workflow_uuid = :'workflow_id';
```

Treat `error` as potentially sensitive. Do not paste production values into an
issue or chat without redaction.

## Diagnose recovery

1. Confirm `/health/ready` and inspect the `DBOS initialized` inventory.
2. Find the workflow by ID, family name, version, and queue.
3. Check `recovery_attempts`, the last update time, and the application logs for
   that workflow ID.
4. Confirm an executor for the workflow's application version is running.
5. For queued work, confirm the persisted queue was registered with its expected
   concurrency.
6. For a wait, distinguish a durable sleep/deadline from a missing signal. Do
   not send an event or mutate DBOS tables merely because a workflow is idle.
7. Inspect the application row and external system separately. Postgres and
   Keto/Ory/storage are reconciled durably, not committed atomically.

Never repair workflow state by directly updating `dbos.workflow_status`,
operation outputs, notifications, or queue tables. Use an application-level
retry/reconciliation path reviewed for that workflow family.

## Drain versus patch

This release keeps DBOS automatic source-hash versioning. It does not set
`applicationVersion`, enable workflow patching, or stamp transactional task
enqueues with an application version.

Before deployment, compare the candidate version with the active inventory:

- If no active workflow belongs to an old version, deployment may proceed.
- If old-version workflows are active, keep the old executor running and let
  them drain.
- If a long-lived wait cannot drain inside the rollout window, stop the deploy.
  Land a separate, reviewed version/drain or patching strategy first.

Do not silently enable patching to unblock one rollout. Version policy affects
every replaying workflow and requires dedicated compatibility tests.

## Rollback

1. Stop routing new HTTP traffic to the bad release.
2. Inventory active workflows grouped by application version before replacing
   executors.
3. Restore the previous HTTP release for request handling.
4. If the bad release's source hash owns active workflows, retain or redeploy an
   executor with that exact code until those workflows drain. The previous
   binary is not assumed compatible with the newer workflow history.
5. Verify readiness, queue registration, and recovery counts after rollback.
6. Re-run the read-only inventory until no workflow is stranded without a
   matching executor.

Do not roll back database migrations by deleting migration records or editing
DBOS state. Use a reviewed forward or reverse migration appropriate to the data
already committed. The task-idempotency columns are nullable, but the diary
transfer uniqueness migration also resolves legacy duplicates and must not be
blindly undone.
