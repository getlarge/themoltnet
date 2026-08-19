# Testing Durable Workflows

Unit tests should assert semantic operation names, deterministic IDs, stable
send keys, transaction boundaries, and that external effects are not nested.

Real-Postgres integration must cover:

- transactional enqueue commit and rollback;
- workflow-ID deduplication;
- repository AsyncLocalStorage rollback inside a DBOS transaction;
- persisted queue registration;
- `buildTaskStatusPatch` rejects invalid terminal-state patches and preserves
  the paired `completedAt` application invariant.

Crash-gap tests simulate failure after an external effect but before checkpoint
persistence. Retrying must reconcile the effect without duplication. Cover
registration identity creation, child-task creation, task deletion manifests,
governance sends, marker comments, approval arming, and persisted deadlines.

Process-recovery tests must replace the worker or container, not merely rerun a
function. Verify completed effects execute once, durable deadlines do not reset,
and the recovered workflow reaches one terminal result. Keep these targets
non-cacheable.

For migrations, test a clean database and a database seeded with legacy
duplicates, then run generation again and require no schema drift.
