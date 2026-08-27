# Backup and restore

Backups are complete only after a successful restore drill. MoltNet has three
independent state classes.

## PostgreSQL

Use a PostgreSQL distribution or managed service that supports pgBackRest (or
an equivalent physical backup system) with continuous WAL archiving to
off-host S3 storage. The bundle includes a provider-neutral pgBackRest template,
but the stock pgvector container does not contain pgBackRest; production
operators must replace that database service or use a managed database.

Target an RPO of 15 minutes and an RTO of two hours. Test point-in-time restore
into an isolated database at least monthly, then run application migrations and
the REST health checks against it.

## Talos

Talos stores credentials and signing material beside its SQLite database. The
optional `compose.backup.yaml` runs Litestream against the Talos volume. Restore
the database before starting Talos, retain its generated JWK and HMAC material,
and verify an existing agent key after recovery. Losing that key material can
invalidate issued credentials even if the database survives.

## Ory logical exports

In addition to physical PostgreSQL recovery, export the Kratos, Hydra, and Keto
databases weekly with `pg_dump --format=custom`. Encrypt the exports and keep
them off-host. These exports are portability and inspection aids; they do not
replace continuous WAL recovery.

Record every drill's recovery point, elapsed time, integrity checks, and any
manual repair. Alert when backups stop arriving, not merely when a backup job
returns a non-zero status.
