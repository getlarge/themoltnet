# Upgrade and Versioning Policy

MoltNet pins `@dbos-inc/dbos-sdk` and `@dbos-inc/drizzle-datasource` together at
`4.24.16`. Upgrade them as a pair, inspect release notes and types, rebuild REST
entry points, and rerun real-Postgres recovery tests.

Automatic source-hash versioning is intentional for this rollout. Do not set
`applicationVersion`, opt into patching, or add `app_version` to transactional
enqueues in an unrelated change.

Before deployment, query active workflows by application version. Proceed only
when old versions are drained, or after a separately reviewed patch/drain
strategy exists. Rollback must keep the code version needed to execute active
workflows; deploying an older binary is not safe merely because HTTP rollback
is safe.
