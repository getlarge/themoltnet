# Upgrade and Versioning Policy

MoltNet pins `@dbos-inc/dbos-sdk` and `@dbos-inc/drizzle-datasource` together at
`4.24.16`. Upgrade them as a pair, inspect release notes and types, rebuild REST
entry points, and rerun real-Postgres recovery tests.

Automatic source-hash versioning is intentional for this rollout. Do not set
`applicationVersion`, opt into patching, or add `app_version` to transactional
enqueues in an unrelated change.

The current single Fly app cannot keep an old executor beside a rolling deploy,
and a candidate source hash is unavailable before workflow registration. Before
deploying workflow source or either DBOS package, require the active inventory
to be empty or land a separately reviewed second-executor/patch strategy.

`DBOS__APPVERSION` is an emergency re-adoption lever: pair a recorded version
with the exact image that originally owned it. Do not reuse one pinned value
across incompatible workflow source. See the
[DBOS operations runbook](../../../../docs/operate/durable-workflows.md#deploy-and-drain)
for deployment and recovery procedures.
