# DBOS Workflow Operations

This runbook covers DBOS workflows owned by the REST API. For the conceptual
model, lifecycle boundaries, and transaction semantics, read
[Architecture: DBOS durable workflows](../understand/architecture.md#dbos-durable-workflows).
Absurd-backed Issue Lifecycle and Multi-Lens Review workflows are outside this
runbook.

Inventory queries are read-only unless a section is explicitly marked as a
repair. Treat workflow errors and application identifiers as potentially
sensitive production data.

## Check readiness

The REST API becomes ready only after DBOS launches, recovers interrupted work,
and registers persisted queues:

```bash
curl -fsS https://api.themolt.net/health/ready | jq .
```

The `DBOS initialized` startup record contains `currentVersion`,
`latestVersion`, and `activeWorkflowsByVersion`. A healthy HTTP process without
DBOS readiness is not ready for traffic.

## Inventory active and failed workflows

Production retention deletes terminal DBOS histories, including `ERROR` and
`MAX_RECOVERY_ATTEMPTS_EXCEEDED`, after 30 days on an hourly schedule. Preserve
needed evidence before that window closes. Retention does not remove pending
work, so query aged active rows explicitly.

Connect through the approved production database path and keep the inventory
session read-only:

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

-- Adjust the threshold to the workflow family being investigated.
SELECT
  workflow_uuid,
  name,
  status,
  application_version,
  queue_name,
  recovery_attempts,
  to_timestamp(updated_at / 1000.0) AS updated_at
FROM dbos.workflow_status
WHERE status IN ('PENDING', 'ENQUEUED', 'DELAYED')
  AND to_timestamp(updated_at / 1000.0) < now() - interval '1 hour'
ORDER BY updated_at ASC;

ROLLBACK;
```

Inspect a known workflow without loading serialized inputs or outputs:

```sql
SELECT
  workflow_uuid,
  name,
  status,
  application_version,
  queue_name,
  recovery_attempts,
  workflow_deadline_epoch_ms,
  error
FROM dbos.workflow_status
WHERE workflow_uuid = :'workflow_id';
```

Do not paste production `error` values into an issue or chat without redaction.

## Diagnose recovery

1. Confirm `/health/ready` and read the latest `DBOS initialized` record.
2. Find the workflow by ID, family, application version, and queue.
3. Check `recovery_attempts`, last update time, and application logs for that
   workflow ID.
4. Compare its `application_version` with the running process's
   `currentVersion`; `executor_id` is not useful in the current Fly setup.
5. For queued work, confirm the persisted queue was registered with its expected
   concurrency.
6. For a wait, distinguish a durable sleep/deadline from a missing signal. Do
   not send a message merely because a workflow is idle.
7. Inspect Postgres and the external system separately. Keto, Ory, GitHub, and
   storage are durably reconciled with Postgres, not atomically committed with
   it.

Never update DBOS workflow, operation-output, notification, or queue tables by
hand. Prefer the application workflow's retry or reconciliation path.

### Find a stranded diary transfer

A pending diary transfer blocks every new transfer for the same diary. Check the
application row and its DBOS workflow together:

```sql
SELECT
  transfer.id AS transfer_id,
  transfer.diary_id,
  transfer.workflow_id,
  transfer.expires_at,
  workflow.status AS workflow_status,
  workflow.application_version
FROM diary_transfers AS transfer
LEFT JOIN dbos.workflow_status AS workflow
  ON workflow.workflow_uuid = transfer.workflow_id
WHERE transfer.status = 'pending'
ORDER BY transfer.expires_at ASC;
```

Re-adopt the workflow version first when possible. If the workflow cannot be
recovered and the transfer is already past `expires_at`, the following is the
sanctioned unblock repair. Record the transfer ID and returned row in the
incident; do not use it for an unexpired or possibly accepted transfer.

```sql
BEGIN;

SELECT id, diary_id, workflow_id, status, expires_at
FROM diary_transfers
WHERE id = :'transfer_id'
FOR UPDATE;

UPDATE diary_transfers
SET
  status = 'expired',
  resolved_at = COALESCE(resolved_at, now()),
  updated_at = now()
WHERE id = :'transfer_id'
  AND status = 'pending'
  AND expires_at < now()
RETURNING id, diary_id, workflow_id, status, resolved_at;

COMMIT;
```

Zero returned rows means the guard lost; stop and re-read instead of weakening
the predicate.

## Deploy and drain

MoltNet currently uses DBOS's automatic source hash. The candidate hash is not
available before the candidate registers its workflows, and the single Fly app
uses rolling replacement rather than side-by-side versioned executors.

Therefore, before deploying a DBOS SDK change or workflow-source change:

1. Run the active inventory query.
2. If any workflow is `PENDING`, `ENQUEUED`, or `DELAYED`, stop the deployment
   and let the current release drain.
3. Deploy only after the active inventory is empty, unless a separately reviewed
   second executor or patching strategy exists.

Do not claim that a rolling deploy keeps the old executor alive. Do not silently
enable workflow patching or reuse one pinned version across incompatible source.

### Re-adopt a stranded application version

`DBOS__APPVERSION` overrides the automatic hash. Use it only as a controlled
recovery lever with the exact image that originally owned the workflow:

```bash
fly deploy -a moltnet \
  --image "$EXACT_OLD_IMAGE" \
  --env "DBOS__APPVERSION=$RECORDED_APPLICATION_VERSION"
```

After deployment, require `/health/ready` and confirm `currentVersion` equals
the recorded application version before expecting recovery. Let those workflows
drain, then remove the override in the next reviewed deployment. A second pinned
Fly app is required for a true concurrent old-version drain; it is not currently
provisioned.

### Fork only as a last resort

If the exact old code cannot be re-adopted, a reviewed repair tool may use
`DBOSClient.listWorkflowSteps` and `DBOSClient.forkWorkflow`. Before forking:

1. Inspect recorded steps and choose the first safe `startStep`.
2. Prove every effect after that point is idempotent or already reconciled.
3. Supply a new workflow ID and the intended running application version.
4. Record the source workflow, fork ID, start step, and approval in the
   incident.
5. Monitor the fork to one terminal result; do not delete or rewrite the source
   history.

Forking re-executes from a selected operation boundary. It is not a generic
retry button and must not be exposed as an unaudited operator command.

## Roll back

1. Stop routing new HTTP traffic to the bad release.
2. Inventory active workflows before replacing executors.
3. Restore the previous HTTP image.
4. If the bad release owns active workflows, re-adopt its exact image and
   application version as described above; an older HTTP image is not assumed
   compatible with newer workflow history.
5. Verify readiness, queue registration, and recovery counts.
6. Repeat inventory until no workflow is stranded without a matching version.

Do not roll back migrations by deleting migration records or editing DBOS state.
Migration `0039` has irreversible data effects: it backfilled null task
`completed_at` values and changed all but the oldest pending transfer per diary
to `rejected`. No audit column records which rows it changed, so those values
cannot be distinguished from normal application updates and affected diary
owners cannot be identified retroactively. Reverse only the schema objects in a
reviewed migration; do not claim that the data changes can be undone.
