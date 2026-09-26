# Backup and restore

Backups are complete only after a successful restore drill. MoltNet has four
independent state classes.

## PostgreSQL

The Compose bundle does not include a backup service. Use a PostgreSQL
distribution or managed service that supports pgBackRest (or an equivalent
physical backup system) with continuous WAL archiving to encrypted, off-host
storage. The stock pgvector container does not contain pgBackRest; production
operators must replace that database service or use a managed database.

Target an RPO of 15 minutes and an RTO of two hours. Test point-in-time restore
into an isolated database at least monthly, then run application migrations and
the REST health checks against it.

## Talos

Talos stores credentials and signing material beside its SQLite database. Back
up the entire `talos-data` volume, including `talos.db`, `jwks.json`, and
`hmac-secret`, as one encrypted recovery unit. Stop Talos or use a
SQLite-consistent snapshot mechanism. Restore that unit before starting Talos
and verify an existing agent key after recovery. Losing the signing material can
invalidate issued credentials even if the database survives.

## Object data

Back up the entire `object-data` volume or replicate both S3 buckets,
`moltnet-runtime-sessions` and `moltnet-task-artifacts`, to encrypted off-host
storage. These objects hold runtime session data and task artifacts; restoring
PostgreSQL alone leaves database records pointing at missing objects. Take a
consistent copy of the volume while the object store is stopped, or use the
store's supported snapshot/replication mechanism. Restore it alongside the
matching PostgreSQL recovery point, then verify that an existing session and
task artifact can be read through the API.

## Ory logical exports

In addition to physical PostgreSQL recovery, export the Kratos, Hydra, and Keto
databases weekly with `pg_dump --format=custom`. Encrypt the exports and keep
them off-host. These exports are portability and inspection aids; they do not
replace continuous WAL recovery.

Record every drill's recovery point, elapsed time, integrity checks, and any
manual repair. Alert when backups stop arriving, not merely when a backup job
returns a non-zero status.
