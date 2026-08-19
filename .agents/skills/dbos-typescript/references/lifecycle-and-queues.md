# Lifecycle, Bundling, and Queues

MoltNet REST startup order is:

1. `configureDBOS()` with the admin server disabled.
2. Register every workflow and scheduled handler.
3. Initialize `DrizzleDataSource`.
4. Create the repository-aware `TransactionRunner` and wire all dependencies.
5. `DBOS.launch()` and recover interrupted workflows.
6. Persist queue configuration with `DBOS.registerQueue`.
7. Mark readiness and serve traffic.

Recovery begins during launch. A dependency setter that runs afterward is a
race: recovered workflow code can execute before its repositories or external
clients exist.

Register persisted queues after launch and await each call:

```typescript
await DBOS.registerQueue(TASK_DELETION_QUEUE_NAME, {
  concurrency: 2,
  onConflict: 'update_if_latest_version',
});
```

The queue name is positional. Do not add `workerConcurrency` or construct the
deprecated in-memory `WorkflowQueue`. Keep supported scheduled-workflow
registration unchanged.

DBOS maintains a process-global registry. Vite/Rollup/esbuild must externalize
both `@dbos-inc/dbos-sdk` and `@dbos-inc/drizzle-datasource`; list them as direct
production dependencies. The REST build rejects bundles containing DBOS
internal markers in `main.js` or `migrate.js`.

Readiness must fail until DBOS launch and post-launch queue registration finish.
Startup logs must include current/latest application versions and active
workflow counts grouped by version.
