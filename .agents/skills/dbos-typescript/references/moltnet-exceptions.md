# MoltNet-Specific Exceptions

## Transactional task-claim enqueue

The task claim path intentionally calls the DBOS SQL function
`dbos.enqueue_workflow` from the application transaction. The DBOS schema is
reachable on the same Postgres database, so the queued-to-dispatched CAS,
attempt-workflow enqueue, and transaction rollback form one atomic Postgres
boundary.

This is a narrow exception. Do not generalize it to `DBOS.startWorkflow()` in a
transaction or to external systems. Tests must prove commit, rollback, and
workflow-ID deduplication.

## External authorization and storage

Postgres transactions cannot atomically commit Keto, Kratos, Hydra, GitHub, or
object storage changes. MoltNet records the database state, then uses durable,
idempotent steps or child workflows to reconcile those systems. Documentation
must say “durably reconciled,” not “atomically swapped,” across systems.

## Source-hash application versions

This branch intentionally leaves `applicationVersion` unset so DBOS uses its
automatic source hash. Do not enable workflow patching or stamp a version onto
transactional enqueues. Deployment is gated on no active old-version workflows,
unless a separate version/drain rollout strategy lands first.
