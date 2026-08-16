# Transactions

Workflow-facing repositories receive `TransactionRunner`, created with
`createDBOSTransactionRunner(dataSource)`. Its `runInTransaction` delegates to
the DBOS Drizzle datasource transaction and installs the repository
AsyncLocalStorage executor.

This does not replace or bypass the DBOS datasource. It ensures repository calls
using `getExecutor(db)` share the same Postgres transaction as the DBOS
transaction checkpoint. A thrown operation rolls back both repository writes
and checkpoint completion.

Rules:

- Put related repository writes and the checkpoint in one registered DBOS
  transaction.
- Do not nest registered steps/transactions inside one another.
- Split external Keto/Ory/storage calls from database transactions. Make each
  effect idempotent and retryable, then reconcile after the database commits.
- A CAS loss is success only when a fresh read proves the requested final state;
  otherwise fail without applying external effects.
- A delete transaction returns the original cleanup manifest. Later steps use
  that manifest for idempotent relationship and object deletion.
- Repository methods used by workflows must resolve their executor with
  `getExecutor(db)` rather than holding a raw pool/client.

See [MoltNet exceptions](moltnet-exceptions.md) for the one intentional raw SQL
transactional enqueue.
