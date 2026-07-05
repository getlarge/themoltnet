# DBOS Transactional Enqueue Experiment

This branch explores the pattern from DBOS's "Postgres Transactions are a
Superpower" article against the current MoltNet layout after workflow packages
were split out.

Current relevant locations:

- `libs/database`: Drizzle, transaction context, DBOS lifecycle.
- `libs/task-service`: task create/claim/report service logic.
- `libs/task-workflows`: DBOS task attempt workflow registered as
  `task.workflow.startAttempt`.
- `libs/signing-workflows`: DBOS signing workflow package.

## What Actually Joins The Transaction?

The DBOS runtime connection does not literally join the app transaction. There
is no second connection and no distributed transaction.

Instead, DBOS 4.13.5 installs a Postgres UDF in the DBOS system schema:

```sql
dbos.enqueue_workflow(
  workflow_name text,
  queue_name text,
  positional_args json[] default array[]::json[],
  named_args json default '{}'::json,
  class_name text default null,
  config_name text default null,
  workflow_id text default null,
  app_version text default null,
  timeout_ms bigint default null,
  deadline_epoch_ms bigint default null,
  deduplication_id text default null,
  priority integer default null,
  queue_partition_key text default null
) returns text
```

Calling this UDF from the app's active Postgres transaction inserts an
`ENQUEUED` row into `dbos.workflow_status` on the same connection as the app
write. If the app transaction rolls back, the DBOS enqueue rolls back too.

## Task Claim Shape

The current task claim path in `libs/task-service/src/task.service.ts` does:

1. CAS `tasks.status` from `queued` to `dispatched` inside a transaction.
2. After commit, call `DBOS.startWorkflow(taskWorkflows.startAttemptWorkflow)`.

The experimental shape would be:

```ts
const claimedRow = await transactionRunner.runInTransaction(
  async () => {
    if (continueFrom) {
      const acquired = await taskRepository.tryAcquireContinuationLock(
        continueFrom.taskId,
        continueFrom.attemptN,
      );
      if (!acquired) {
        throw new TaskServiceError(
          'conflict',
          'Another daemon is claiming a continuation of the same parent attempt; leaving task queued',
        );
      }
    }

    const claimed = await taskRepository.claimIfQueued(taskId);
    if (!claimed) return null;

    await enqueueWorkflowInCurrentTransaction(db, {
      workflowName: 'task.workflow.startAttempt',
      queueName: 'task-attempts',
      workflowId,
      positionalArgs: [
        taskId,
        attemptN,
        callerId,
        workflowId,
        leaseTtlSec,
        claimedExecutor?.fingerprint ?? null,
        row.dispatchTimeoutSec ?? null,
        row.runningTimeoutSec ?? null,
      ],
    });

    return claimed;
  },
  { name: 'task.claim.cas-and-enqueue' },
);
```

Now the CAS update and DBOS enqueue share one commit boundary:

- commit succeeds: task row is dispatched and the DBOS workflow is queued.
- rollback happens: task row remains queued and no workflow row exists.

That removes the row-committed-but-workflow-not-started window.

## Constraints

- The UDF stores inputs as portable JSON (`serialization = 'portable_json'`).
  The target workflow must be registered with, or at least compatible with,
  DBOS portable serialization. `libs/task-workflows` currently registers
  `task.workflow.startAttempt` without an explicit serialization setting, so a
  real migration should validate this before wiring the helper into claim.
- This helps only with Postgres app writes plus DBOS system rows. It does not
  make Keto, Ory, GitHub, or other external systems transactional.
- The UDF enqueues work. The DBOS runtime still has to be running and serving
  the queue name.
- If DBOS exposes an official TypeScript API that accepts an existing
  `PoolClient`/transaction, prefer that over keeping a local SQL adapter.

## Candidate Sites After The Move

1. `libs/task-service`: task claim plus `task.workflow.startAttempt` enqueue.
2. `apps/rest-api/src/routes/signing-requests.ts`: create signing request row
   plus `libs/signing-workflows` enqueue.
3. `apps/rest-api/src/routes/teams.ts` and `apps/rest-api/src/routes/diary.ts`:
   create pending team/transfer rows plus workflow enqueue; keep Keto/Ory
   effects inside durable workflow steps.
